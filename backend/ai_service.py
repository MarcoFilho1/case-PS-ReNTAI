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
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3-8b-instruct:free")
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

async def validate_document(file_content: bytes, filename: str) -> float:
    """
    Consome a API da OpenRouter pra avaliar se realmente o arquivo enviado 
    é um documento legítimo ou um documento qualquer
    Caso o documento seja muito grande ele trunca em 3000 caracteres pra evitar estourar
    o token da IA que é gratuita
    """

    if not OPENROUTER_API_KEY or not OPENROUTER_MODEL or not OPENROUTER_URL:
        logger.warning("Credenciais da OpenRouter não configuradas. Retornando 0.0 de confiança.")
        return 0.0
    
    sample_text = ""
    is_pdf = filename.lower().endswith(".pdf")

    if is_pdf:
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
        "Você é um sistema de auditoria de segurança hospitalar especializado em telemedicina.\n"
        "Sua tarefa é analisar os metadados e o conteúdo textual extraído de um arquivo (via PDF ou OCR) "
        "para determinar se ele se parece com um documento legítimo de apoio clínico (ex: exames, laudos, "
        "prontuários, receitas ou documentos de identidade do paciente).\n\n"
        "Regra estrita: Você deve responder APENAS com um objeto JSON válido, sem qualquer texto adicional antes ou depois. "
        "O formato do JSON deve ser exatamente:\n"
        "{\n"
        '  "is_legitimate": boolean,\n'
        '  "confidence_score": float\n'
        "}\n"
        "Onde confidence_score é um valor decimal entre 0.00 e 1.00."
    )

    user_prompt = f"""Nome do arquivo: {filename}
                    Tamanho: {len(file_content)} bytes
                    Conteúdo extraído:
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
                return 0.80

            response_data = response.json()
            content_str = response_data['choices'][0]['message']['content'].strip()
            
            if content_str.startswith("```"):
                content_str = content_str.strip("```json").strip("```").strip()

            result = json.loads(content_str)
            return float(result.get("confidence_score", 0.50))

    except Exception as e:
        logger.error(f"Falha na validação de IA por exceção: {str(e)}")
        return 0.0