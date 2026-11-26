import type { Proposito } from "./tipos-de-datos";

/** «Reemplazar el comprobante» (NOTAS-2c-2): el formulario, el permiso y el propósito de los datos de `registro-de-compras.ts` que ese formulario usa (producto y motivo). Va aparte porque ese archivo está en su tope de líneas. */
export const DEL_REEMPLAZO = {
  formulario: "apps/web/ui/plantillas/compras/reemplazo/FormularioDeReemplazar.cliente.tsx",
  accion: ["comprobantes_de_proveedor.reemplazar"] as const,
  proposito: (para: string): Proposito => ({
    para,
    fuente:
      "Pantalla 11 de la maqueta de Diseño 2 y `decisiones-del-dueno-2026-11.md` (P-1 del 26/11/2026); ficha aprobada por el orquestador el 26/11/2026 (NOTAS-2c-2); quién: gerente y administrador (comprobantes_de_proveedor.reemplazar)",
  }),
};
