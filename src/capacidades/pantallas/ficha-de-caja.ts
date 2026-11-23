import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «CAJA» DEL MOSTRADOR (DDD:174: toda pantalla nueva nace con ficha). Tramos C1 y C2: abrir y cerrar la caja y ver la jornada con su cierre. Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los botones con
 * la acción de permiso que cada uno envía, los estados y cada texto con SU uso y SU fuente. Es solo una declaración (todavía no existen los tipos comunes ni el analizador de fichas): lleva su
 * propio tipo local y la comprueba `test/web/ficha-de-caja.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`caja.html`, Pedernal-docs 10-ux-ui; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño). Los desvíos 1 a 3 están APROBADOS por el dueño (Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila del 19/11/2026 «Caja, pantalla de apertura (PR-C1)», «Sí a las 3 diferencias como recomiendas»):
 *  1. Fondo sugerido: la maqueta rellena «Fondo inicial» con el efectivo contado en el último cierre y dice «Sugerido: el efectivo contado en el último cierre» (`vAbrir`; M15, aprobado
 *     el 15/11). Acá el campo nace vacío y no hay texto. Fundamento: es dinero que la pantalla propondría sin que nadie lo declare; falta decidir si se sugiere. Costo de cambiarlo: un valor
 *     inicial y una clave de texto (M15).
 *  2. Botón fijo al pie: la maqueta pone «Abrir caja» en un pie fijo de la pantalla; acá el botón va al final del formulario (igual que en Depósitos, decidido el 18/11).
 *  3. «‹» para volver: la maqueta lo pone en la barra; acá el formulario trae «Cancelar» al pie. Reusa un texto aprobado y no suma uno.
 *  4. Día en cierre o cerrado: la maqueta avisa «El día está en cierre. Cancelá el cierre para seguir» y «El día ya está cerrado» (decisión 175). Acá el servidor rechaza con el mensaje
 *     genérico «Esta acción no está permitida» (P5, 15/11), sin texto por regla. Las dos claves aprobadas no se cargan; sumarlas es un cambio de catálogo y del traductor de errores.
 *  5. «Cierre del día» (la otra fila del grupo «Caja» de `menu-por-areas.html`): no existe todavía y no se declara.
 *
 *  6. Sin ingreso, egreso, ajuste ni anulación de movimientos: la maqueta los trae y se reemplazan por el acto único de ingreso y salida de dinero (decisión del 18/11): no se construyen con la versión
 *     vieja. La lista de la jornada es solo de lectura; un ingreso o egreso manual viejo, si existiera, se rotula con su clase cruda.
 *  7. Cierre con diferencia: el arqueo muestra la diferencia con su signo (en rojo si falta, en aviso si sobra) y deja cerrar (criterio permisivo del 18/11, SUPUESTO P2, DEC-0768): no pide nota ni bloquea, y no suma texto.
 *  8. «Volver» en «Contar» solo vuelve a la vista anterior y no cancela el cierre (SUPUESTO, DEC-0455).
 *
 * SUPUESTOS DE ESTE TRAMO (el dueño no los respondió; se declaran con su costo de revertir): P1 (DEC-0766), permisos del cierre = la tabla de a9 (`sesiones_caja.iniciar_cierre`, `cancelar_cierre`, `cerrar`,
 * confirmada por delegación el 15/11; revertir: cambiar la acción de cada botón, sin migración). P3 (DEC-0767), cada caja se abre por separado y tiene su propia sesión (un bloque por caja; revertir: pedir
 * una sola abierta por sucursal en el servidor, y la pantalla no cambia). P2, lo de arriba (7).
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
const DE_LA_TABLA_DE_TEXTOS_NUEVOS: FuenteDeTexto = {
  decidio:
    "el dueño, 15/11/2026 (aceptó todos los textos propuestos; decisiones-del-dueno-2026-11.md, fila 171) y delegación de las filas 173 a 175 para «conforme» y el aviso del día en cierre (decisión 175)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta caja.html, tabla «Textos nuevos» (línea 282): caja.conforme, caja.conforme_general, caja.sin_declarar, caja.sin_cuenta",
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
    "apps/web/ui/plantillas/caja/FormularioDeCierre.cliente.tsx",
    "apps/web/ui/plantillas/caja/modelo-de-la-caja.ts",
    "apps/web/ui/plantillas/caja/modelo-de-conteo-de-caja.ts",
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
      id: "cerrar",
      texto: "caja.sesion.cerrar",
      hace: { envia: "sesiones_caja.iniciar_cierre" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cerrar-ok",
      texto: "caja.sesion.cerrar",
      hace: { envia: "sesiones_caja.cerrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar-cierre",
      texto: "caja.sesion.cancelar_cierre",
      hace: { envia: "sesiones_caja.cancelar_cierre" },
      sinPermiso: "APAGADO",
    },
    {
      id: "conforme",
      texto: "caja.conforme",
      hace: "abre-el-formulario",
      sinPermiso: "AUSENTE",
    },
    {
      id: "conforme-general",
      texto: "caja.conforme_general",
      hace: "abre-el-formulario",
      sinPermiso: "AUSENTE",
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
    "caja.sesion.cerrar": {
      usos: ["BloqueDeCaja.cliente.tsx", "FormularioDeCierre.cliente.tsx"],
      fuente: REUTILIZADOS,
    },
    "caja.sesion.cancelar_cierre": {
      usos: ["FormularioDeCierre.cliente.tsx"],
      fuente: REUTILIZADOS,
    },
    "caja.sesion.contar": { usos: ["BloqueDeCaja.cliente.tsx (título)"], fuente: REUTILIZADOS },
    "caja.arqueo.esperado": {
      usos: ["FormularioDeCierre.cliente.tsx", USO_DEL_MODELO],
      fuente: REUTILIZADOS,
    },
    "caja.arqueo.contado": { usos: ["FormularioDeCierre.cliente.tsx"], fuente: REUTILIZADOS },
    "caja.arqueo.diferencia": {
      usos: ["FormularioDeCierre.cliente.tsx", USO_DEL_MODELO],
      fuente: REUTILIZADOS,
    },
    "caja.arqueo.observacion_opcional": {
      usos: ["FormularioDeCierre.cliente.tsx"],
      fuente: REUTILIZADOS,
    },
    "caja.arqueo.billetes": { usos: ["FormularioDeCierre.cliente.tsx"], fuente: REUTILIZADOS },
    "caja.arqueo.cantidad": { usos: ["FormularioDeCierre.cliente.tsx"], fuente: REUTILIZADOS },
    "caja.arqueo.monedas": { usos: ["FormularioDeCierre.cliente.tsx"], fuente: REUTILIZADOS },
    "caja.arqueo.total_contado": { usos: ["FormularioDeCierre.cliente.tsx"], fuente: REUTILIZADOS },
    "caja.conforme": {
      usos: [USO_DEL_MODELO, "FormularioDeCierre.cliente.tsx"],
      fuente: DE_LA_TABLA_DE_TEXTOS_NUEVOS,
    },
    "caja.conforme_general": {
      usos: [USO_DEL_MODELO, "FormularioDeCierre.cliente.tsx"],
      fuente: DE_LA_TABLA_DE_TEXTOS_NUEVOS,
    },
    "caja.sin_declarar": {
      usos: [USO_DEL_MODELO, "FormularioDeCierre.cliente.tsx"],
      fuente: DE_LA_TABLA_DE_TEXTOS_NUEVOS,
    },
    "caja.sin_cuenta": {
      usos: [USO_DEL_MODELO, "FormularioDeCierre.cliente.tsx"],
      fuente: DE_LA_TABLA_DE_TEXTOS_NUEVOS,
    },
    "caja.sesion.ultima": {
      usos: [USO_DEL_BLOQUE],
      fuente: {
        decidio:
          "el dueño, 15/11/2026 (aceptó los textos M8 a M14 propuestos; decisiones-del-dueno-2026-11.md, fila 171)",
        donde:
          "Pedernal-docs 11-especificaciones/textos-mostrador-pendientes.md, M12 («Última sesión»)",
      },
    },
    "caja.estado.anulado": {
      usos: [USO_DEL_BLOQUE],
      fuente: {
        decidio:
          "el dueño, 15/11/2026 (aceptó los textos T4 y T5; decisiones-del-dueno-2026-11.md, fila 165)",
        donde:
          "Pedernal-docs 11-especificaciones/textos-nuevos-pendientes.md, T4 («Anulado», caja.html:405)",
      },
    },
    "caja.movimiento.cobro": {
      usos: [USO_DEL_MODELO],
      fuente: {
        decidio:
          "el dueño, por delegación (decisiones-del-dueno-2026-11.md, filas 173 y 174), asentada en DEC-0476",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta caja.html (líneas 382, 383 y 502); DEC-0476 (arquitectura/decisiones/registro/DEC-0476.json)",
      },
    },
    "caja.movimiento.fondo_inicial": {
      usos: [USO_DEL_MODELO],
      fuente: {
        decidio:
          "el dueño, por delegación (decisiones-del-dueno-2026-11.md, filas 173 y 174), asentada en DEC-0476",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta caja.html (líneas 382, 383 y 502); DEC-0476 (arquitectura/decisiones/registro/DEC-0476.json)",
      },
    },
    "caja.movimiento.anulacion": {
      usos: [USO_DEL_MODELO],
      fuente: {
        decidio:
          "el dueño, por delegación (decisiones-del-dueno-2026-11.md, filas 173 y 174), asentada en DEC-0476",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta caja.html (líneas 382, 383 y 502); DEC-0476 (arquitectura/decisiones/registro/DEC-0476.json)",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeCaja;
