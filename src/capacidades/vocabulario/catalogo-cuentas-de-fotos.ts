/**
 * Los textos de la pantalla «Conectá tu cuenta de fotos» (cuentas de imagen declaradas, 0102). En su archivo para que `catalogo-catalogo.ts` no pase el tope de líneas; `CATALOGO_DE_TEXTOS` los suma con un spread.
 *
 * PROPUESTA de la sesión de construcción, de UX3 §5.7.6 y del brief del 25/11/2026 (`brief-logo-de-la-carta-cuentas-declaradas-2026-11-25.md` §8), pendiente del OK del dueño (DEC-CAT-001):
 * «Conectá tu cuenta de fotos» (CD-1) y «Pegá el nombre de tu cuenta» (CD-3). Los demás rótulos de la pantalla son textos ya aprobados («Guardar», «Quitar», «Motivo»). NO están: el paso
 * «¿Ya tenés cuenta en Cloudinary?» (CD-2: necesita un enlace externo sin verificar), «Revisá dos cosas en tu cuenta» (CD-4: los nombres de las opciones de Cloudinary no están verificados con una
 * cuenta real); los errores y avisos (CD-5, CD-6 y CD-7) son el genérico aprobado, sin texto nuevo.
 */
export const TEXTOS_DE_CUENTAS_DE_FOTOS = {
  "catalogo.cuentas_de_fotos.titulo": {
    porDefecto: "Conectá tu cuenta de fotos",
    fuente: { decision: "DEC-CAT-001" },
  },
  "catalogo.cuentas_de_fotos.cuenta": {
    porDefecto: "Pegá el nombre de tu cuenta",
    usos: [{ como: "DATO", dato: "cuenta-de-foto" }],
    fuente: { decision: "DEC-CAT-001" },
  },
} as const;
