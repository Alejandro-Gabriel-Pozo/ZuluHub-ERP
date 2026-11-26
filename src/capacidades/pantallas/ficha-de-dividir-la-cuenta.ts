import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE «DIVIDIR LA CUENTA» (SAL-E2, S11) Y DE LA LISTA DE CUENTAS DE UNA MESA DIVIDIDA (S9; DDD:174: toda pantalla nueva nace con ficha). Es parte de la pantalla «Mesa» (`ficha-de-la-mesa.ts`: misma ruta, mismo acceso)
 * y la de «Cobrar» una cuenta hija (`?cuenta=` en la ruta de cobrar la mesa). Declara lo que se ve y se hace en la hoja de reparto por ítems y en la lista de cuentas: los botones con la acción de permiso que cada uno envía y cada texto
 * con SU uso y SU fuente. Todos los textos ya existían en el catálogo (aprobados con las maquetas `salon.html` y `unir.html`, 09/11/2026); ninguno es nuevo. «Por porcentaje» NO tiene pantalla propia: es un cobro con varios
 * importes (DEC-SAL-001). La comprueba `test/web/ficha-de-dividir-la-cuenta.test.ts`. Previene: un botón o un texto que nadie aprobó y una hoja que se desfasa de lo declarado.
 */
const USO_DEL_MODELO = "textos-de-dividir.ts y modelo-de-dividir.ts (SAL-E2)";
const SALON_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `salon.html`, grupo «Dividir»; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta salon.html (grupo «Dividir») y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
} as const;
const UNIR_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `unir.html`, grupo «Dividir por ítems y unir»; D115: 302 textos y CYN 117)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta unir.html y 11-especificaciones/briefs/salon/SAL-E2-dividir-la-cuenta.md §3 (S11)",
} as const;
const GENERAL_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 (aprobó el texto en la venta rápida y la ficha de la vidriera; D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maquetas venta-rapida-v4.html y salon.html, y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
} as const;

export const FICHA_DE_DIVIDIR_LA_CUENTA = {
  archivos: [
    "apps/web/ui/plantillas/salon/DividirLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/HojaDeDividir.cliente.tsx",
    "apps/web/ui/plantillas/salon/LineaDeLaDivision.cliente.tsx",
    "apps/web/ui/plantillas/salon/CuentasDeLaMesaDividida.cliente.tsx",
    "apps/web/ui/plantillas/salon/UnirODividirLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/modelo-de-dividir.ts",
    "apps/web/ui/plantillas/salon/textos-de-dividir.ts",
    "apps/web/ui/plantillas/salon/CobroDeLaMesa.cliente.tsx",
    "apps/web/app/s/app/(operacion)/salon/cuenta/[mesaId]/cobrar/page.tsx",
  ],
  rutas: ["/salon/cuenta/[mesaId]", "/salon/cuenta/[mesaId]/cobrar"],
  titulo: "salon.texto.unir_dividir_por_items",
  acceso: "mesas.ver",
  botones: [
    {
      id: "dividir",
      texto: "salon.texto.dividir_dividir_la_cuenta",
      hace: { envia: "salon.dividir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-division",
      texto: "salon.texto.unir_dividir_ahora",
      hace: { envia: "salon.dividir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cobrar-cuenta",
      texto: "ventas.cobro.cobrar",
      hace: { envia: "tickets.cobrar" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "salon.texto.dividir_dividir_la_cuenta": {
      usos: ["botón que abre la hoja de dividir", USO_DEL_MODELO],
      fuente: SALON_APROBADO,
    },
    "salon.texto.unir_dividir_por_items": {
      usos: ["título de la hoja de dividir por ítems", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_cuentas": {
      usos: ["subtítulo de la lista de cuentas de la hoja", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_agregar_cuenta": {
      usos: ["botón de sumar una cuenta (hasta el máximo)", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_falta_asignar": {
      usos: ["estado de la línea que no se repartió del todo", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_cuenta_vacia": {
      usos: ["estado de la cuenta sin nada", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_dividir_ahora": {
      usos: ["botón «Confirmar división»", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_entero": {
      usos: ["forma de repartir una línea: entera a una cuenta", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_por_unidades": {
      usos: ["forma de repartir una línea: cada unidad a una cuenta", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_compartido": {
      usos: ["forma de repartir una línea: en partes iguales entre cuentas", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_repartir": {
      usos: ["rótulo de las formas de repartir una línea", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_entre_cuales": {
      usos: ["rótulo de las cuentas entre las que se comparte una línea", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.unir_el_centavo_que_sobra_va_a_la_cuenta_1": {
      usos: ["aviso de una línea compartida", USO_DEL_MODELO],
      fuente: UNIR_APROBADO,
    },
    "salon.texto.dividir_cuenta_n": {
      usos: ["rótulo «Cuenta N» de cada cuenta (plantilla con la N final)", USO_DEL_MODELO],
      fuente: SALON_APROBADO,
    },
    "salon.texto.dividir_pendiente": {
      usos: ["estado de una cuenta hija sin cobrar", USO_DEL_MODELO],
      fuente: SALON_APROBADO,
    },
    "salon.texto.dividir_cobrada": {
      usos: ["estado de una cuenta hija ya cobrada", USO_DEL_MODELO],
      fuente: SALON_APROBADO,
    },
    "salon.texto.dividir_volver_a_las_cuentas": {
      usos: ["botón del resultado de cobrar una cuenta cuando quedan otras", USO_DEL_MODELO],
      fuente: SALON_APROBADO,
    },
    "salon.texto.dividir_mesa_cobrada": {
      usos: ["aviso del resultado de cobrar la última cuenta", USO_DEL_MODELO],
      fuente: SALON_APROBADO,
    },
    "ventas.venta.cancelar": {
      usos: ["botón «Cancelar» de la hoja", USO_DEL_MODELO],
      fuente: GENERAL_APROBADO,
    },
    "vidriera.producto.cerrar": {
      usos: ["nombre accesible del botón de cerrar la hoja", USO_DEL_MODELO],
      fuente: GENERAL_APROBADO,
    },
    "ventas.cobro.cobrar": {
      usos: ["botón «Cobrar» de cada cuenta hija", USO_DEL_MODELO],
      fuente: GENERAL_APROBADO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
