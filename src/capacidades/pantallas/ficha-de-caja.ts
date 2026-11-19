import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «CAJA» DEL MOSTRADOR (DDD:174: toda pantalla nueva nace con ficha). Tramo C1: abrir la caja. Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los botones con
 * la acción de permiso que cada uno envía, los estados y cada texto con SU uso y SU fuente. Es solo una declaración (todavía no existen los tipos comunes ni el analizador de fichas): lleva su
 * propio tipo local y la comprueba `test/web/ficha-de-caja.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`caja.html`, Pedernal-docs 10-ux-ui; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño; hoy ninguno tiene respuesta):
 *  1. Fondo sugerido: la maqueta rellena «Fondo inicial» con el efectivo contado en el último cierre y dice «Sugerido: el efectivo contado en el último cierre» (`vAbrir`; M15, aprobado
 *     el 15/11). Acá el campo nace vacío y no hay texto. Fundamento: es dinero que la pantalla propondría sin que nadie lo declare; falta decidir si se sugiere. Costo de cambiarlo: un valor
 *     inicial y una clave de texto (M15).
 *  2. Botón fijo al pie: la maqueta pone «Abrir caja» en un pie fijo de la pantalla; acá el botón va al final del formulario (igual que en Depósitos, decidido el 18/11).
 *  3. «‹» para volver: la maqueta lo pone en la barra; acá el formulario trae «Cancelar» al pie. Reusa un texto aprobado y no suma uno.
 *  4. Día en cierre o cerrado: la maqueta avisa «El día está en cierre. Cancelá el cierre para seguir» y «El día ya está cerrado» (decisión 175). Acá el servidor rechaza con el mensaje
 *     genérico «Esta acción no está permitida» (P5, 15/11), sin texto por regla. Las dos claves aprobadas no se cargan; sumarlas es un cambio de catálogo y del traductor de errores.
 *  5. «Última sesión» (resumen de la caja cerrada) y la lista de movimientos de la jornada: fuera del tramo C1 (van con el tramo C2).
 *  6. «Cierre del día» (la otra fila del grupo «Caja» de `menu-por-areas.html`): no existe todavía y no se declara.
 *
 * DEC-0502 (cobrar usa la única caja abierta; sin caja abierta pide abrirla): la oferta queda lista para Cobrar sin construir Cobrar: `RUTA_DE_LA_CAJA` (`lista-de-caja.ts`) es la
 * dirección y `accionesDeLaPantallaDeCaja` (`servidor/ofertas-de-caja.ts`) dice si la persona puede abrir.
 */

type FuenteDeTexto = Readonly<{
  /** Quién lo decidió y cuándo: nunca «lo aprobó el orquestador». */
  decidio: string;
  /** Documento y lugar verificables (repositorio de documentos, Pedernal-docs). */
  donde: string;
}>;

type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;

type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }> | "abre-el-formulario";
  /** Qué se ve sin el permiso: el botón apagado (o ausente) es solo una ayuda; decide el servidor. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeCaja = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** La acción que exige la consulta de la pantalla y la fila del menú. */
  acceso: ClaveAccion;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", "GENERICO">>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const REUTILIZADOS: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la versión anterior de la pantalla) y 15/11/2026 (aceptó todos los textos propuestos; decisiones-del-dueno-2026-11.md, fila 171)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta caja.html, lista «(reutilizados)» de la sección «Textos nuevos» (línea 282)",
};
const USO_DEL_BLOQUE = "BloqueDeCaja.cliente.tsx";
const USO_DEL_MODELO = "modelo-de-la-caja.ts";

export const FICHA_DE_CAJA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/caja/page.tsx",
    "apps/web/app/s/app/acciones-de-sesion-de-caja.ts",
    "apps/web/servidor/sesion-de-caja.ts",
    "apps/web/servidor/ofertas-de-caja.ts",
    "apps/web/ui/plantillas/caja/PantallaDeCaja.tsx",
    "apps/web/ui/plantillas/caja/BloqueDeCaja.cliente.tsx",
    "apps/web/ui/plantillas/caja/FormularioDeApertura.cliente.tsx",
    "apps/web/ui/plantillas/caja/modelo-de-la-caja.ts",
  ],
  rutas: ["/caja"],
  titulo: "caja.pantalla.titulo",
  acceso: "cajas.ver",
  botones: [
    {
      id: "abrir",
      texto: "caja.sesion.abrir",
      hace: "abre-el-formulario",
      sinPermiso: "APAGADO",
    },
    {
      id: "abrir-ok",
      texto: "caja.sesion.abrir",
      hace: { envia: "sesiones_caja.abrir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar",
      texto: "caja.accion.cancelar",
      hace: { navega: "/caja" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "caja.pantalla.titulo": {
      usos: ["título de la pantalla", "fila del menú"],
      fuente: REUTILIZADOS,
    },
    "caja.estado.abierta": { usos: [USO_DEL_MODELO], fuente: REUTILIZADOS },
    "caja.estado.cerrada": { usos: [USO_DEL_MODELO], fuente: REUTILIZADOS },
    "caja.sesion.abrir": {
      usos: [USO_DEL_BLOQUE, "título del formulario", "botón de enviar"],
      fuente: REUTILIZADOS,
    },
    "caja.medios.tipo.efectivo": { usos: [USO_DEL_MODELO], fuente: REUTILIZADOS },
    "caja.accion.cancelar": { usos: ["CuerpoDeFormularioDeCaja.tsx"], fuente: REUTILIZADOS },
    "caja.sesion.jornada": {
      usos: [USO_DEL_MODELO],
      fuente: {
        decidio:
          "el dueño, 15/11/2026 (aceptó los textos M8 a M14 propuestos; decisiones-del-dueno-2026-11.md, fila 171)",
        donde:
          "Pedernal-docs 11-especificaciones/textos-mostrador-pendientes.md, M14 («Jornada {fecha} · Corte {hora}»)",
      },
    },
    "caja.sesion.corte": {
      usos: [USO_DEL_MODELO],
      fuente: {
        decidio:
          "el dueño, 15/11/2026 (aceptó los textos M8 a M14 propuestos; decisiones-del-dueno-2026-11.md, fila 171)",
        donde:
          "Pedernal-docs 11-especificaciones/textos-mostrador-pendientes.md, M14 («Jornada {fecha} · Corte {hora}»)",
      },
    },
    "caja.campo.fondo_inicial": {
      usos: ["FormularioDeApertura.cliente.tsx (rótulo del campo)"],
      fuente: {
        decidio:
          "el dueño, por delegación (decisiones-del-dueno-2026-11.md, filas 173 y 174), asentada en DEC-0475",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta caja.html, `vAbrir` (línea 420: «Fondo inicial»); DEC-0475 (arquitectura/decisiones/registro/DEC-0475.json)",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeCaja;
