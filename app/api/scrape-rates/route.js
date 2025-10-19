// /app/api/scrape-rates/route.js

import { NextResponse } from 'next/server';
import { createWorker } from 'tesseract.js';
import { createServerClient } from '../../../lib/supabase/supabaseServer.js'; 

export const dynamic = 'force-dynamic'; 

const IMAGE_URL = 'https://wa.cambiocuba.money/trmi.png'; 
const BASE_CURRENCY = 'CUP'; 
const CURRENCY_MAPPING = {
    'USD': 'USD', 'USO': 'USD', 
    'EURO': 'EUR', 'MLC': 'MLC',
    'EUR': 'EUR'
};

export async function GET() {
    let worker;
    const ratesToInsert = [];

    try {
        const supabase = createServerClient();
        
        // 1. Inicializar Tesseract Worker. 
        // CLAVE: worker: false fuerza la ejecución en el proceso principal de Node, 
        // evitando el error de Worker.
        worker = await createWorker('eng', 1, { worker: false }); 
        
        // 2. Ejecutar OCR
        const { data: { text } } = await worker.recognize(IMAGE_URL);
        
        console.log("--- OCR Texto Crudo ---:\n", text); // Para ver el resultado de la lectura
        
        // 3. Procesamiento y Limpieza del Texto
        const lines = text.split('\n').filter(line => line.trim() !== '');
        const dataLines = lines.slice(1); 

        for (const line of dataLines) {
            const parts = line.trim().split(/\s+/).filter(p => p.length > 0);
            
            if (parts.length >= 3) {
                let currencyName = parts[0].toUpperCase();
                let rateText = parts[2]; 

                const currencyCode = CURRENCY_MAPPING[currencyName] || null;
                const rate = parseFloat(rateText.replace(/[^0-9.]/g, '')); 

                if (currencyCode && !isNaN(rate) && rate > 0) {
                    ratesToInsert.push({
                        currency_from: currencyCode, 
                        currency_to: BASE_CURRENCY, 
                        rate: rate, 
                    });
                }
            }
        }

        // 4. Upsert en Supabase
        if (ratesToInsert.length > 0) {
            // ... (Lógica de upsert en Supabase) ...
            
            // Simulación de éxito si no quieres conectar la DB ahora:
            // return NextResponse.json({ success: true, message: `Simulación de éxito. ${ratesToInsert.length} tasas encontradas.` }, { status: 200 });
            
            // Código real de DB
            const { error: dbError } = await supabase
                .from('exchange_rates') 
                .upsert(ratesToInsert, { 
                    onConflict: 'currency_from, currency_to', 
                    fields: ['rate', 'updated_at'] 
                });

            if (dbError) {
                console.error("Error de Supabase al insertar/actualizar:", dbError);
                throw new Error(dbError.message);
            }
        } else {
            throw new Error(`OCR no pudo extraer datos válidos. Texto: ${text}`);
        }
        
        return NextResponse.json(
            { success: true, message: `OCR exitoso. ${ratesToInsert.length} tasas actualizadas.` }, 
            { status: 200 }
        );

    } catch (error) {
        console.error('Fallo en el proceso OCR/Guardado:', error.message);
        
        if (worker) await worker.terminate();
        
        return NextResponse.json(
            { success: false, message: 'Fallo OCR/Inserción.', error: error.message },
            { status: 500 }
        );
    } finally {
        if (worker) await worker.terminate();
    }
}