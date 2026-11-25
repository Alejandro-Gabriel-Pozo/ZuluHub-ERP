import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «SALÓN» (SAL-A, el mapa de mesas; DDD:174: toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los botones, los estados y cada texto con SU uso
 * y SU fuente. Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba `ficha-de-salon.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no
 * se desfase. No crea acciones ni permisos: declara los que ya existen (`mesas.ver`, módulo `salon`, perilla `salon`).
 * Hoy es SOLO el mapa: la ficha de una mesa (tocarla, tomar pedido, enviar, cobrar, unir, dividir) llega con SAL-B en adelante y entonces esta ficha suma esos botones. Sin textos pendientes: «Todas», «No hay mesas en este
 * estado», los minutos abiertos y el nombre del mozo no figuran porque su texto no está aceptado todavía (inventario `salon-dia-uno-inventario-de-textos.md`, sección B: TX-S1-01, TX-S1-07 y TX-S2-01).
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

const MAQUETA_APROBADA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `salon.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta salon.html (tabla «Estados de la mesa y filtros») y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.1",
} as const;
const USO_DEL_MODELO = "modelo-del-mapa.ts (mapa)";

export const FICHA_DE_SALON = {
  archivos: [
    "apps/web/app/s/app/(operacion)/salon/page.tsx",
    "apps/web/ui/plantillas/salon/PantallaDelSalon.tsx",
    "apps/web/ui/plantillas/salon/modelo-del-mapa.ts",
  ],
  rutas: ["/salon"],
  titulo: "salon.texto.grupo_salon",
  acceso: "mesas.ver",
  botones: [
    {
      id: "filtro-libres",
      texto: "salon.texto.estado_libres",
      hace: { navega: "/salon?filtro=LIBRES" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "filtro-en-pedido",
      texto: "salon.texto.estado_en_pedido",
      hace: { navega: "/salon?filtro=EN_PEDIDO" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "filtro-ocupadas",
      texto: "salon.texto.estado_ocupadas",
      hace: { navega: "/salon?filtro=OCUPADAS" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "salon.texto.grupo_salon": {
      usos: ["título de la pantalla", "fila del menú"],
      fuente: {
        decidio: "el dueño, 13/11/2026 (nombres de grupos del menú por áreas aprobados)",
        donde: "Pedernal-docs 10-ux-ui, maqueta menu-por-areas.html, texto `p.salon` (ap: true)",
      },
    },
    "salon.texto.estado_mesas": {
      usos: ["rótulo de la lista de mesas (lectores de pantalla)"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.estado_libre": { usos: [USO_DEL_MODELO], fuente: MAQUETA_APROBADA },
    "salon.texto.estado_en_pedido": {
      usos: [USO_DEL_MODELO, "filtro «En pedido»"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.estado_ocupada": { usos: [USO_DEL_MODELO], fuente: MAQUETA_APROBADA },
    "salon.texto.estado_libres": { usos: ["filtro «Libres»"], fuente: MAQUETA_APROBADA },
    "salon.texto.estado_ocupadas": { usos: ["filtro «Ocupadas»"], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_mesa_numero": {
      usos: ["título de cada mesa («Mesa 7»)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (maqueta `mesas.html`, rótulo de cada tarjeta; el mismo «Mesa 5» del papel de la comanda)",
        donde: "Pedernal-docs 10-ux-ui, maqueta mesas.html, función `vLista`",
      },
    },
    "salon.texto.unir_unida_a_la_mesa": {
      usos: ["estado de una mesa unida («Unida a la mesa 5»)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (aprobó la maqueta `unir.html`; D115) y decisión 116 sobre unir mesas",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta unir.html y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
      },
    },
    "salon.texto.dividir_cuenta_n": {
      usos: ["cuentas de una mesa dividida («Cuenta 1 · $ 100,00»)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (aprobó las maquetas `salon.html` y `unir.html`; D115, CYN 89 y 90)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta salon.html (grupo «Dividir») y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
