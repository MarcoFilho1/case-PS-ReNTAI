import os
import json
import httpx
import logging
import io
from pypdf import PdfReader
from PIL import Image
import pytesseract
from pdf2image import convert_from_bytes
logger = logging.getLogger("uvicorn.error")

THRESHOLD = float(os.getenv("AI_VALIDATION_THRESHOLD", 0.75))
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "z-ai/glm-4.5-air:free")
OPENROUTER_URL = os.getenv("OPENROUTER_URL", "")

def extract_text_from_pdf(file_content: bytes) -> str:
    try:
        pdf_file = io.BytesIO(file_content)
        reader = PdfReader(pdf_file)

        extracted_text = ""

        for page in reader.pages:
            text = page.extract_text()
            if text:
                extracted_text += text + "\n"
            
        return extracted_text.strip()

    except Exception as e:
        logger.error(f"Erro ao extrair texto do PDF: {e}")
        return ""

def extract_text_with_ocr(file_content: bytes, filename: str) -> str:
    """
    Utiliza o OCR pra extrair texto de imagem ou pdf escaneados
    """
    try:
        extracted_text = ""
        is_pdf = filename.lower().endswith(".pdf")

        if is_pdf:
            images = convert_from_bytes(file_content, dpi=200)
            for img in images:
                extracted_text += pytesseract.image_to_string(img, lang='por') + "\n"
        
        else:
            img = Image.open(io.BytesIO(file_content))
            extracted_text = pytesseract.image_to_string(img, lang='por') + "\n"
        
        return extracted_text.strip()

    except Exception as e:
        logger.error(f"Erro durante o OCR: {e}")
        return ""

async def validate_document(
    file_content: bytes, 
    filename: str, 
    specialty: str, 
    diagnostic_hypothesis: str, 
    clinical_history: str
) -> tuple[float, str | None, str | None]:
    """
    Consome a API da OpenRouter para avaliar se o anexo clínico está
    totalmente encaixado com o contexto médico (área médica + especialidade solicitada)
    e retorna o score de confiança (0.0 a 1.0), o motivo da rejeição (se houver) e o resumo de IA.
    """

    default_summary = (
        f"Solicitação de teleconsultoria na especialidade de {specialty.replace('_', ' ').title()}. "
        f"Hipótese diagnóstica inicial: {diagnostic_hypothesis}. "
        f"Histórico clínico do paciente: {clinical_history}."
    )

    if not OPENROUTER_API_KEY or not OPENROUTER_MODEL or not OPENROUTER_URL:
        logger.warning("Credenciais da OpenRouter não configuradas. Retornando 0.0 de confiança.")
        return 0.0, "Credenciais do serviço de validação por IA não configuradas.", default_summary
    
    sample_text = ""
    is_pdf = filename.lower().endswith(".pdf")
    is_txt = filename.lower().endswith(".txt")

    if is_txt:
        try:
            sample_text = file_content.decode("utf-8")
        except Exception:
            sample_text = file_content.decode("latin-1", errors="ignore")
    elif is_pdf:
        sample_text = extract_text_from_pdf(file_content)
        if len(sample_text) < 50:
            logger.info(f"PDF sem texto nativo detectado: {filename}. Chamando o OCR")
            sample_text = extract_text_with_ocr(file_content, filename)
    else:
        logger.info(f"Imagem detectada {filename}. Chamando OCR")
        sample_text = extract_text_with_ocr(file_content, filename)

    if not sample_text:
        sample_text = "[Falha ao extrair texto. O arquivo pode estar corrompido, em branco ou a imagem está ilegível]"
    
    if len(sample_text) > 3000:
        sample_text = sample_text[:3000] + "\n\n[...TEXTO TRUNCADO POR LIMITE DE TAMANHO...]"

    system_prompt = (
        "Você é um sistema de auditoria médica avançado de telemedicina.\n"
        "Sua tarefa é analisar o conteúdo textual e metadados de um documento clínico anexado a uma solicitação de teleconsultoria "
        "e avaliar o quanto ele está alinhado com o contexto médico da solicitação (especialidade solicitada, hipótese diagnóstica e histórico clínico).\n"
        "Além disso, você deve gerar um resumo clínico conciso e muito bem estruturado do caso em português (de 2 a 4 parágrafos) integrando as principais informações da solicitação e do documento fornecido.\n\n"
        "Critérios de avaliação de confiança:\n"
        "- Quanto mais próximo de 0.00: O documento não tem relação alguma com a área médica ou com o contexto da especialidade e sintomas informados.\n"
        "- Quanto mais próximo de 1.00: O documento está totalmente encaixado com o contexto médico e a especialidade solicitada.\n\n"
        "Regra estrita: Você deve responder APENAS com um objeto JSON válido, sem qualquer texto adicional antes ou depois. "
        "O formato do JSON deve ser exatamente:\n"
        "{\n"
        '  "confidence_score": float,\n'
        '  "rejection_reason": string or null,\n'
        '  "ai_summary": string\n'
        "}\n"
        "Onde:\n"
        "- confidence_score é um valor decimal entre 0.00 e 1.00.\n"
        "- rejection_reason é uma justificativa em português explicando claramente o motivo do desalinhamento ou falha na adequação do documento (caso o score seja baixo, e.g., < 0.85). Se o documento for considerado totalmente legítimo e adequado, este campo deve ser null.\n"
        "- ai_summary é o resumo clínico conciso do caso em português, contendo a queixa do paciente, hipótese diagnosticada e achados do documento."
    )

    user_prompt = f"""Especialidade Solicitada: {specialty}
Hipótese Diagnóstica: {diagnostic_hypothesis}
Histórico Clínico: {clinical_history}

Nome do arquivo anexado: {filename}
Tamanho do arquivo: {len(file_content)} bytes
Conteúdo extraído do documento:
{sample_text}"""

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Telemedicina APP Test",
    }

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(OPENROUTER_URL, headers=headers, json=payload, timeout=20.0)
            
            if response.status_code != 200:
                logger.error(f"Erro na API OpenRouter: {response.status_code} - {response.text}")
                return 0.80, "Falha de conexão com a API de inteligência artificial externa.", default_summary

            response_data = response.json()
            content_str = response_data['choices'][0]['message']['content'].strip()
            
            if content_str.startswith("```"):
                content_str = content_str.strip("```json").strip("```").strip()

            result = json.loads(content_str)
            
            try:
                confidence_score = float(result.get("confidence_score", 0.50))
            except (ValueError, TypeError):
                confidence_score = 0.50

            rejection_reason = result.get("rejection_reason")
            if not rejection_reason or rejection_reason == "null":
                rejection_reason = None

            ai_summary = result.get("ai_summary")
            if not ai_summary:
                ai_summary = default_summary

            return confidence_score, rejection_reason, ai_summary

    except Exception as e:
        logger.error(f"Falha na validação de IA por exceção: {str(e)}")
        return 0.0, f"Erro interno ao processar validação por IA: {str(e)}", default_summary