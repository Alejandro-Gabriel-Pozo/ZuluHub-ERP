import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la factura que se carga con «Nueva compra» y del pago de una factura del registro de datos (ver `registro.ts`), en su propio archivo para que el de compras no pase del tamaño (Compras PR 7 y PR 8). Cada campo
 * lleva su primitiva (una regla, un lugar): la validez de cada uno la decide el servidor al correr el caso de uso.
 */

const REQUIERE_COMPRAS = { modulo: "compras", estadoDeEmpresa: ["ACTIVE"] } as const;

const FORMULARIO_DE_PAGO =
  "apps/web/ui/plantillas/compras/pago/FormularioDeDeclararPago.cliente.tsx";
const PAGAR_FACTURA = ["comprobantes_de_proveedor.pagar"] as const;
const DE_PAGAR_UNA_FACTURA = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-8-pago-de-una-factura.md` de Compras (rama de planificación de la Ola 1) y maqueta `compra-pago.html` (aceptada por delegación, DDD:187 y 188); quién: gerente y administrador (comprobantes_de_proveedor.pagar y anular_pago); el efectivo siempre sale de una caja abierta (dueño, 16/11/2026, 3A)",
});

const BLOQUE_DE_FACTURA = "apps/web/ui/plantillas/compras/nueva/BloqueDeFactura.cliente.tsx";
const REGISTRAR_COMPRA_CON_FACTURA = [
  "recepciones.registrar",
  "comprobantes_de_proveedor.registrar",
] as const;
const DE_LA_FACTURA = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-7-factura-en-la-compra.md` de Compras (rama de planificación de la Ola 1) y maqueta `compra.html` (estados `factura` y `factura-total`); el bloque va dentro de «Nueva compra» (respuesta del orquestador, 24/11/2026); quién: los tres roles (recepciones.registrar y comprobantes_de_proveedor.registrar)",
});

const FORMULARIO_DE_NOTA =
  "apps/web/ui/plantillas/compras/notas/FormularioDeCargarNota.cliente.tsx";
const REGISTRAR_UNA_NOTA = [
  "notas_de_credito_de_proveedor.registrar",
  "notas_de_debito_de_proveedor.registrar",
] as const;
const DE_LA_NOTA = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-NOTAS-1-notas-de-credito-y-debito-con-pagos.md` (pantalla 10) y maqueta `briefs/maquetas/servicios-y-bienes-de-uso.html` («Cargar una nota del proveedor»); ficha aprobada por el orquestador el 26/11/2026 (NOTAS-2c-1); quién: gerente y administrador (notas_de_credito_de_proveedor.registrar y notas_de_debito_de_proveedor.registrar)",
});

/** «Reemplazar el comprobante» (NOTAS-2c-2): el formulario, el permiso y el propósito que declaran los datos que ese formulario usa y que viven en `registro-de-compras.ts` (producto y motivo). */
export const DEL_REEMPLAZO = {
  formulario: "apps/web/ui/plantillas/compras/reemplazo/FormularioDeReemplazar.cliente.tsx",
  accion: ["comprobantes_de_proveedor.reemplazar"] as const,
  proposito: (para: string): Proposito => ({
    para,
    fuente:
      "Pantalla 11 de la maqueta de Diseño 2 (según el pedido del orquestador) y `decisiones-del-dueno-2026-11.md` (P-1 del 26/11/2026: el costo del stock no cambia al reemplazar); ficha aprobada por el orquestador el 26/11/2026 (NOTAS-2c-2); quién: gerente y administrador (comprobantes_de_proveedor.reemplazar)",
  }),
};

export const DATOS_DE_COMPRAS_FACTURA_Y_PAGO = {
  "fecha-de-pago-de-compra": {
    // Que la fecha sea real y no futura (el «hoy» de Argentina) lo decide el servidor (`leerPago`); la pantalla solo ofrece la de hoy y tope en hoy como ayuda.
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [DE_PAGAR_UNA_FACTURA("Fecha en que se pagó la factura (por defecto, hoy).")],
    consumidores: [FORMULARIO_DE_PAGO],
    ponerPor: PAGAR_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "medio-de-pago-de-compra": {
    // La lista cerrada vive UNA vez, en el dominio (`MEDIOS_DE_PAGO`, la misma de los tipos de medio de caja): la pantalla la importa.
    ficha: "src/modulos/compras/dominio/pago.ts",
    propositos: [DE_PAGAR_UNA_FACTURA("Con qué medio se pagó la factura (lista cerrada).")],
    consumidores: [FORMULARIO_DE_PAGO],
    ponerPor: PAGAR_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "importe-de-medio-de-pago-de-compra": {
    // Lo que paga un medio cuando el pago tiene varios; la suma contra el total de la factura la comprueba el servidor bajo el bloqueo (`resolverLosMedios`).
    ficha: "src/modulos/compras/dominio/pago.ts",
    propositos: [
      DE_PAGAR_UNA_FACTURA(
        "Cuánto paga cada medio cuando la factura se paga con varios (la suma es el total de la factura; con un solo medio no se escribe).",
      ),
    ],
    consumidores: [FORMULARIO_DE_PAGO],
    ponerPor: PAGAR_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "caja-de-pago-de-compra": {
    ficha: "src/modulos/compras/dominio/pago.ts",
    propositos: [
      DE_PAGAR_UNA_FACTURA(
        "Caja abierta de la sucursal de la que sale el efectivo (solo con el medio efectivo, y obligatoria).",
      ),
    ],
    consumidores: [FORMULARIO_DE_PAGO],
    ponerPor: PAGAR_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "motivo-de-egreso-de-compra": {
    // La regla del motivo (1 a 500 caracteres, de una línea, con una letra) vive UNA vez en el dominio: el egreso de caja, corregir y anular usan la misma `motivoDeAnulacionDesdeTexto`.
    ficha: "src/modulos/compras/dominio/registrar-compra.ts",
    propositos: [
      DE_PAGAR_UNA_FACTURA("Motivo del egreso de caja de un pago en efectivo (obligatorio)."),
    ],
    consumidores: [FORMULARIO_DE_PAGO],
    ponerPor: PAGAR_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "tipo-de-comprobante-de-compra": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FACTURA(
        "Tipo de la factura del proveedor (A, B o C): de la lista cerrada de comprobantes; la nota de crédito y la de débito no se cargan acá.",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA],
    ponerPor: REGISTRAR_COMPRA_CON_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "punto-de-venta-de-factura": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FACTURA(
        "Punto de venta impreso en la factura; tiene que estar declarado en la ficha del proveedor (lo valida el servidor).",
      ),
      DE_LA_NOTA(
        "Punto de venta impreso en la nota del proveedor; tiene que estar declarado en la ficha del proveedor (lo valida el servidor).",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA, FORMULARIO_DE_NOTA],
    ponerPor: [...REGISTRAR_COMPRA_CON_FACTURA, ...REGISTRAR_UNA_NOTA],
    requiere: REQUIERE_COMPRAS,
  },
  "numero-de-factura": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FACTURA(
        "Número impreso en la factura; la misma factura (proveedor, tipo, punto de venta y número) no se carga dos veces.",
      ),
      DE_LA_NOTA(
        "Número impreso en la nota del proveedor; la misma nota (proveedor, tipo, punto de venta y número) no se carga dos veces.",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA, FORMULARIO_DE_NOTA],
    ponerPor: [...REGISTRAR_COMPRA_CON_FACTURA, ...REGISTRAR_UNA_NOTA],
    requiere: REQUIERE_COMPRAS,
  },
  "fecha-de-factura": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      DE_LA_FACTURA("Fecha impresa en la factura."),
      DE_LA_NOTA("Fecha impresa en la nota del proveedor."),
    ],
    consumidores: [BLOQUE_DE_FACTURA, FORMULARIO_DE_NOTA],
    ponerPor: [...REGISTRAR_COMPRA_CON_FACTURA, ...REGISTRAR_UNA_NOTA],
    requiere: REQUIERE_COMPRAS,
  },
  "vencimiento-de-pago": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [DE_LA_FACTURA("Fecha de vencimiento de pago de la factura (opcional).")],
    consumidores: [BLOQUE_DE_FACTURA],
    ponerPor: REGISTRAR_COMPRA_CON_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "cantidad-facturada-de-linea": {
    ficha: "src/modulos/compras/dominio/decimal.ts",
    propositos: [
      DE_LA_FACTURA(
        "Cantidad facturada de cada línea, en la unidad base del producto (se precarga con la del renglón).",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA],
    ponerPor: REGISTRAR_COMPRA_CON_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "precio-neto-de-linea": {
    ficha: "src/modulos/compras/dominio/decimal.ts",
    propositos: [
      DE_LA_FACTURA(
        "Precio neto de cada línea, por la unidad base del producto, sin IVA (se precarga con el del renglón si se paga por la unidad base).",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA],
    ponerPor: REGISTRAR_COMPRA_CON_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "alicuota-de-linea": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FACTURA("Alícuota de IVA de cada línea de una factura A (lista cerrada del dominio)."),
      DE_LA_NOTA(
        "Alícuota de IVA del importe de la nota del proveedor (lista cerrada del dominio).",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA, FORMULARIO_DE_NOTA],
    ponerPor: [...REGISTRAR_COMPRA_CON_FACTURA, ...REGISTRAR_UNA_NOTA],
    requiere: REQUIERE_COMPRAS,
  },
  percepciones: {
    ficha: "src/modulos/compras/dominio/factura.ts",
    propositos: [
      DE_LA_FACTURA(
        "Importe de percepciones de la factura (opcional; se guarda como un tributo sin clasificar).",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA],
    ponerPor: REGISTRAR_COMPRA_CON_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "total-segun-la-factura": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FACTURA(
        "Total que dice el papel de la factura; si no coincide con la suma del servidor avisa y se carga igual.",
      ),
      DE_LA_NOTA(
        "Total que dice el papel de la nota del proveedor; el servidor lo compara con la suma de sus importes.",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA, FORMULARIO_DE_NOTA],
    ponerPor: [...REGISTRAR_COMPRA_CON_FACTURA, ...REGISTRAR_UNA_NOTA],
    requiere: REQUIERE_COMPRAS,
  },
  "tipo-de-nota-del-proveedor": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_NOTA(
        "Tipo de la nota del proveedor (A, B o C) de la clase que pide la pantalla (crédito o débito): de la lista cerrada de comprobantes; el servidor rechaza un tipo de otra clase.",
      ),
    ],
    consumidores: [FORMULARIO_DE_NOTA],
    ponerPor: REGISTRAR_UNA_NOTA,
    requiere: REQUIERE_COMPRAS,
  },
  "importe-neto-de-nota-por-alicuota": {
    ficha: "src/modulos/compras/dominio/decimal.ts",
    propositos: [
      DE_LA_NOTA(
        "Neto de la nota del proveedor para su alícuota, como dice el papel (la nota no tiene líneas); el IVA, el total y el tope de lo acreditable los calcula y valida el servidor.",
      ),
    ],
    consumidores: [FORMULARIO_DE_NOTA],
    ponerPor: REGISTRAR_UNA_NOTA,
    requiere: REQUIERE_COMPRAS,
  },
  "cuit-de-proveedor-nuevo": {
    ficha: "src/primitivas/identificacion-fiscal/cuit.ts",
    propositos: [
      DE_LA_FACTURA(
        "CUIT del proveedor, solo en su primera factura (sin CUIT en su ficha): queda guardado en la ficha del proveedor.",
      ),
    ],
    consumidores: [BLOQUE_DE_FACTURA],
    ponerPor: REGISTRAR_COMPRA_CON_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
