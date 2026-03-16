#!/usr/bin/env python3
"""Parse a real estate price list PDF and output units as JSON."""
import pdfplumber, json, re, sys

if len(sys.argv) < 2:
    print("[]")
    sys.exit(0)

units = []
with pdfplumber.open(sys.argv[1]) as pdf:
    for page in pdf.pages:
        text = page.extract_text() or ""
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue

            # Match unit number: #101, 201, 1103, etc.
            unit_match = re.search(r'#?(\d{3,5}[A-Z]?)\b', line)
            if not unit_match:
                continue

            # Match price: $2,050,000.00 or $2,050,000
            price_match = re.search(r'\$([\d,.O]+)', line)
            if not price_match:
                continue

            price_str = price_match.group(1).replace(',', '').replace('O', '0')
            # Remove trailing .00
            if price_str.endswith('.00'):
                price_str = price_str[:-3]
            try:
                price = float(price_str)
            except:
                continue

            if price < 100000 or price > 50000000:
                continue

            # Area: last decimal number before the $ sign
            before_price = line[:line.find('$')] if '$' in line else line
            area_matches = re.findall(r'(\d+[,.]\d+)', before_price)
            area = float(area_matches[-1].replace(',', '.')) if area_matches else None

            # Unit type
            tipo = ""
            upper = line.upper()
            if "1 REC" in upper: tipo = "1 REC"
            elif "2 REC" in upper: tipo = "2 REC"
            elif "3 REC" in upper: tipo = "3 REC"
            elif "ESTUDIO" in upper: tipo = "ESTUDIO"
            elif "PH" in upper or "PENTHOUSE" in upper: tipo = "PENTHOUSE"
            elif "LOCAL" in upper: tipo = "LOCAL"

            # Model (T-01, T-3-A, etc.)
            model_match = re.search(r'T-[\w-]+', line)
            model = model_match.group(0) if model_match else ""

            # Status
            status = "DISPONIBLE"
            lower = line.lower()
            if "vendido" in lower or "vendida" in lower:
                status = "VENDIDA"
            elif "apartado" in lower or "reserv" in lower or "separad" in lower:
                status = "APARTADA"

            # Bedrooms
            bedrooms = None
            bed_match = re.search(r'(\d)\s*REC', upper)
            if bed_match:
                bedrooms = int(bed_match.group(1))

            units.append({
                "unitNumber": unit_match.group(1),
                "unitType": tipo or model,
                "area_m2": area,
                "price": price,
                "status": status,
                "currency": "MXN",
                "bedrooms": bedrooms,
            })

print(json.dumps(units))
