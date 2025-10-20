// /app/api/scrape-rates/route.js

import { NextResponse } from 'next/server';
import tesseract from 'node-tesseract-ocr';
import axios from 'axios'; 
import { createServerClient } from '../../../lib/supabase/supabaseServer.js'; 

export const dynamic = 'force-dynamic'; 

const IMAGE_URL = 'https://wa.cambiocuba.money/trmi.png'; 
const BASE_CURRENCY = 'CUP'; 

// Mapeo de Monedas: Asegura que todos los códigos de moneda sean de 3 letras.
const CURRENCY_MAPPING = {
    'USD': 'USD', 'USO': 'USD', 
    'EURO': 'EUR', 'EUR': 'EUR', 
    'MLC': 'MLC', 
    'GBP': 'GBP', 'CAD': 'CAD', 
    'MXN': 'MXN', 'BRL': 'BRL', 
    'ZELLE': 'ZEL', // Mapea ZELLE (5) a ZEL (3)
    'CLA': 'CLA', 
    '3': 'CLA', // 💡 Corrección específica para el error "3" de CLA
    '“3': 'CLA', // 💡 Corrección específica para el error "“3" de CLA
};

const config = {
    lang: "eng", 
    oem: 1,      
    psm: 6,      
};

export async function GET() {
    const ratesToInsert = [];

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
        // Omitimos la primera línea y la última (información de ESTABLECIDA/VICENTE)
        const dataLines = lines.slice(1, -1); 

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

            // Identificar el nombre de la moneda
            let currencyName = (parts[0] === '1' ? parts[1] : parts[0]).toUpperCase();

            // 💡 Paso 3.1: Mapeo y Saneamiento del Código de Moneda
            let currencyCode = CURRENCY_MAPPING[currencyName];

            if (!currencyCode) {
                 // Si falla el mapeo, cortamos a 3 (ej. 'CLAVE' -> 'CLA')
                 currencyCode = currencyName.substring(0, 3);
            }
            
            // 💡 Paso 3.2: Localización de la Tasa
            // Usamos una expresión regular para encontrar el primer número que parezca una tasa.
            // Esto es más robusto que buscar por posición.
            const rateMatch = line.match(/(\d+\.\d{2})/); // Busca un patrón como "450.48" o "23.53"
            
            let rateText = rateMatch ? rateMatch[0] : null;

            if (!rateText) continue;

            const rate = parseFloat(rateText); 

            if (!isNaN(rate) && rate > 0) {
                // -----------------------------------------------------
                // 4. INSERCIÓN BIDIRECCIONAL 
                // -----------------------------------------------------

                // A. Tasa Directa (Ej. ZEL -> CUP)
                ratesToInsert.push({
                    currency_from: currencyCode, 
                    currency_to: BASE_CURRENCY, 
                    rate: rate,
                });

                // B. Tasa Invertida/Recíproca (Ej. CUP -> ZEL)
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

            return NextResponse.json(
                { success: true, message: `OCR exitoso. Se insertaron ${finalCount} registros bidireccionales.` }, 
                { status: 200 }
            );

        } else {
            throw new Error(`OCR no pudo extraer datos válidos. Texto completo: ${text}`);
        }
        
    } catch (error) {
        console.error('Fallo en el proceso OCR/Guardado:', error.message);
        
        return NextResponse.json(
            { success: false, message: 'Fallo al actualizar las tasas.', error: error.message },
            { status: 500 }
        );
    }
}