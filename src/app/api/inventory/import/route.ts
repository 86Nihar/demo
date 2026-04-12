import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), 'prodect.txt');
        if (!fs.existsSync(filePath)) {
            return NextResponse.json({ error: "prodect.txt not found in project root" }, { status: 404 });
        }
        
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.includes('Item Name SKU Purchase Price Last Modified Time'));

        let products = [];
        let currentNameParts = [];

        for (const line of lines) {
            if (line.includes('Rs.')) {
                let fullStr = [...currentNameParts, line].join(' ');
                
                const priceMatch = fullStr.match(/Rs\.?([0-9,.]+)/);
                const priceStr = priceMatch ? priceMatch[1] : "0";
                const purchasePrice = parseFloat(priceStr.replace(/,/g, ''));
                
                const dateMatch = fullStr.match(/([0-9]{2} [a-zA-Z]{3} [0-9]{4} [0-9]{2}:[0-9]{2} (AM|PM))/i);
                let rawDate = dateMatch ? dateMatch[1] : "";
                
                let isoDate = "2025-01-01";
                if (dateMatch) {
                    const d = new Date(rawDate);
                    if (!isNaN(d.getTime())) {
                        isoDate = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
                    }
                }
                
                let idVal = "";
                let name = fullStr;
                
                const splitTags = ["IMEI -", "SL. NO -", "SL -", "SL-", "1."];
                for (const tag of splitTags) {
                    if (fullStr.indexOf(tag) !== -1) {
                        let parts = fullStr.split(tag);
                        name = parts[0].trim();
                        let remainder = parts.slice(1).join(tag).trim();
                        
                        idVal = remainder.split('Rs.')[0].trim();
                        if (idVal.endsWith('.')) {
                            idVal = idVal.slice(0, -1).trim();
                        }
                        break;
                    }
                }

                if (!idVal) idVal = "UNKNOWN-" + Math.floor(Math.random()*100000);

                products.push({
                    name,
                    imeiNo: idVal,
                    purchasePrice,
                    isoDate
                });
                
                currentNameParts = [];
            } else {
                currentNameParts.push(line);
            }
        }

        return NextResponse.json({ products });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
