// /pages/api/scrape-rates.js (¡IMPORTANTE: la ruta ha cambiado!)

// Nota: ya no es necesario importar NextResponse.
import tesseract from 'node-tesseract-ocr';
import axios from 'axios'; 
import { createServerClient } from '../../../lib/supabase/supabaseServer.js'; 

// Esta configuración ya no es necesaria en la API Route clásica
// export const dynamic = 'force-dynamic'; 

const IMAGE_URL = 'https://wa.cambiocuba.money/trmi.png'; 
const BASE_CURRENCY = 'CUP'; 

// Mapeo de Monedas: Asegura que todos los códigos de moneda sean de 3 letras.
const CURRENCY_MAPPING = {
    'USD': 'USD', 'USO': 'USD', 
    'EURO': 'EUR', 'EUR': 'EUR', 
    'MLC': 'MLC', 
    'GBP': 'GBP', 'CAD': 'CAD', 
    'MXN': 'MXN', 'BRL': 'BRL', 
    'ZELLE': 'ZEL', // Corregido: Mapea ZELLE (5) a ZEL (3)
    'CLA': 'CLA', 
    '3': 'CLA',     // Corrección por posible error de lectura OCR
    '“3': 'CLA',   // Corrección por posible error de lectura OCR
};

const config = {
    lang: "eng", 
    oem: 1,      
    psm: 6,      
};

// 💡 Adaptación para Pages Router: export default async function handler(req, res)
export default async function handler(req, res) { 
    const ratesToInsert = [];

    // Verificamos que solo se permita el método GET
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const supabase = createServerClient();
        
        // 1. DESCARGA A BUFFER
        const imageResponse = await axios.get(IMAGE_URL, { 
            responseType: 'arraybuffer'
        });
        const imageBuffer = Buffer.from(imageResponse.data);
        
        // 2. EJECUTAR OCR
        const text = await tesseract.recognize(imageBuffer, config);
        
        console.log("Texto Crudo Extraído por OCR:\n", text); 
        
        // 3. PROCESAMIENTO, LIMPIEZA Y EXTRACCIÓN
        const lines = text.split('\n').filter(line => line.trim() !== '');
        const dataLines = lines.slice(1, -1); // Omitimos encabezado y pie de página

        for (const line of dataLines) {
            // Limpieza robusta de ruido
            let cleanedLine = line
                .replace(/i/g, 'l') 
                .replace(/O/g, '0') 
                .replace(/Pr|Pz|As|=S5|A”|V”°|V””|-|\/|\||“|'|<-|\[|\]/g, '') 
                .replace(/\s+/g, ' ') 
                .trim();
            
            const parts = cleanedLine.split(' ').filter(p => p.length > 0);
            
            if (parts.length < 3) continue;

            let currencyName = (parts[0] === '1' ? parts[1] : parts[0]).toUpperCase();

            // 3.1: Mapeo y Saneamiento del Código de Moneda
            let currencyCode = CURRENCY_MAPPING[currencyName];
            if (!currencyCode) {
                 currencyCode = currencyName.substring(0, 3);
            }
            
            // 3.2: Localización de la Tasa con Regex (más robusto contra ruido)
            const rateMatch = line.match(/(\d+\.\d{2})/); 
            let rateText = rateMatch ? rateMatch[0] : null;

            if (!rateText) continue;

            const rate = parseFloat(rateText); 

            if (!isNaN(rate) && rate > 0) {
                // 4. INSERCIÓN BIDIRECCIONAL 
                // A. Tasa Directa (Ej. USD -> CUP)
                ratesToInsert.push({
                    currency_from: currencyCode, 
                    currency_to: BASE_CURRENCY, 
                    rate: rate,
                });

                // B. Tasa Invertida/Recíproca (Ej. CUP -> USD)
                const reciprocalRate = 1 / rate;

                ratesToInsert.push({
                    currency_from: BASE_CURRENCY, 
                    currency_to: currencyCode,    
                    rate: reciprocalRate,         
                });
            }
        }

        // 5. UPSERT EN SUPABASE
        if (ratesToInsert.length > 0) {
            const { error: dbError } = await supabase
                .from('exchange_rates') 
                .upsert(ratesToInsert, { 
                    onConflict: 'currency_from, currency_to', 
                    fields: ['rate', 'updated_at'] 
                });

            const finalCount = ratesToInsert.length; 
            
            if (dbError) throw new Error(dbError.message);

            // 💡 Respuesta final para Pages Router (res.status().json)
            return res.status(200).json(
                { success: true, message: `OCR exitoso. Se insertaron ${finalCount} registros bidireccionales.` }
            );

        } else {
            throw new Error(`OCR no pudo extraer datos válidos.`);
        }
        
    } catch (error) {
        console.error('Fallo en el proceso OCR/Guardado:', error.message);
        
        // 💡 Manejo de errores para Pages Router
        return res.status(500).json(
            { success: false, message: 'Fallo al actualizar las tasas.', error: error.message }
        );
    }
}