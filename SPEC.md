# SPEC — harta logica a cladirii

Aplicatie folosita DUPA intrarea in companie. Fara cautare sau aplicare la joburi.

## Module
| Modul | Responsabil | Rol |
|---|---|---|
| mapping | A | inregistrare traseu, Claude produce graful, om verifica si publica |
| navigation | B | traseu cu filtre, pas cu pas, calibrare ritm |
| alerts | B + C | stare live (defectiuni), evacuare personala |
| tour | C | tur inainte de prima zi |

## Reguli
1. Modulele importa doar din `src/core`, niciodata unul din altul.
2. Fiecare modul expune doar ce e in `index.ts`.
3. Paginile din `src/app` sunt subtiri: doar apeleaza modulele.
4. Formatul hartii e in `src/core/building/types.ts`; se schimba doar impreuna.
5. Lucram pe `data/sample-map.json` pana e gata harta reala.

## Navigare
- Pozitia se confirma prin "am ajuns" (atingere sau voce). Nu promitem pozitionare continua.
- Timpul dintre repere = distanta. Butonul "Reper" opreste cronometrul, face poza si nota vocala.
- Metri aproximativi = secunde x ~1.3.

## Confidentialitate
- Nicio informatie despre diagnostic; profilul ramane pe dispozitiv.
- Se pastreaza doar cadre cu repere, nu video.
- Harta se publica doar dupa verificare umana.
