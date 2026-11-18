import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de las comandas del registro de datos (ver `registro.ts`), en su propio archivo (una línea en el registro por módulo, sin pisar a los demás): los tres datos de una impresora de la pantalla
 * «Impresoras» (S-2). El largo del nombre y los conjuntos cerrados de uso y de papel viven UNA vez, en el dominio de comandas (la ficha del dato); la pantalla no escribe ningún número.
 */

const FORMULARIO_DE_IMPRESORA = "apps/web/ui/plantillas/salon/FormularioDeImpresora.cliente.tsx";
const FICHA_DEL_NOMBRE = "src/modulos/comandas/dominio/envio.ts";
const FICHA_DEL_USO_Y_DEL_PAPEL = "src/modulos/comandas/dominio/impresion.ts";
const REQUIERE_COMANDAS = { modulo: "comandas", estadoDeEmpresa: ["ACTIVE"] } as const;
const PONER_IMPRESORAS = ["impresoras.crear", "impresoras.editar"] as const;

const DE_LA_IMPRESORA = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/salon-s2-impresoras-plan.md §2 (datos a registrar) y e7-salon-e-impresion-especificacion.md §3.5 (`registrarImpresora` y `editarImpresora`), y la maqueta aprobada el 09/11/2026 (`imprimir.html`, «Agregar impresora», carpeta de prototipos de Pedernal-docs 10-ux-ui); quién: Gerente y Administrador (el dueño, impresoras.*)",
});

export const DATOS_DE_COMANDAS = {
  "nombre-de-impresora": {
    ficha: FICHA_DEL_NOMBRE,
    propositos: [
      DE_LA_IMPRESORA(
        "Nombre de la impresora al agregarla y editarla: para reconocerla en la lista; único por sucursal.",
      ),
    ],
    consumidores: [FORMULARIO_DE_IMPRESORA],
    ponerPor: PONER_IMPRESORAS,
    requiere: REQUIERE_COMANDAS,
  },
  "uso-de-impresora": {
    ficha: FICHA_DEL_USO_Y_DEL_PAPEL,
    propositos: [
      DE_LA_IMPRESORA("Para qué sirve la impresora: comanda de cocina o ticket del cliente."),
    ],
    consumidores: [FORMULARIO_DE_IMPRESORA],
    ponerPor: PONER_IMPRESORAS,
    requiere: REQUIERE_COMANDAS,
  },
  "papel-de-impresora": {
    ficha: FICHA_DEL_USO_Y_DEL_PAPEL,
    propositos: [DE_LA_IMPRESORA("Ancho del papel de la impresora: 58 u 80 mm.")],
    consumidores: [FORMULARIO_DE_IMPRESORA],
    ponerPor: PONER_IMPRESORAS,
    requiere: REQUIERE_COMANDAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
