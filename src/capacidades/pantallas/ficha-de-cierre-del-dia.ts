import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE «CIERRE DEL DÍA» (DDD:174: toda pantalla nace con ficha). Una ruta, `/caja/cierre-del-dia`, con tres pasos mientras el día está en cierre (Cobros, Conciliación por medio, Hay que reconocer),
 * el estado de la jornada, «Empezar el cierre», «Cancelar cierre», «Corregir medio», «Declarado», «Conforme general», «Reconocer» y «Cerrar el día». Es solo una declaración: la comprueba
 * `test/web/ficha-de-cierre-del-dia.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`cierre-del-dia.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño):
 *  1. El avance entre pasos lleva el nombre aprobado del paso al que va, con el «›» de la maqueta («Conciliación por medio ›», «Hay que reconocer ›»); no existe «Siguiente» ni un «Volver» con texto: la flecha «‹»
 *     lleva la etiqueta accesible de `ventas.ticket.volver` (el mismo «‹» de la ficha del ticket). El dueño lo decidió el 21/11/2026 (brief CD v2 §9).
 *  2. Las marcas de «Reconocer» viven en memoria: se pierden al recargar o al cancelar el cierre (valor por defecto del brief CD, costo de revertir bajo). «Reconocer» no envía nada; las marcas viajan con «Cerrar el día».
 *  3. No hay campo de observación general del día: la maqueta no lo dibuja y se manda `null`.
 *  4. Los cobros son la primera página (hasta 100) sin «Más» (valor por defecto S10 del brief CD).
 *  5. Quién cerró, reconoció o corrigió se muestra con el correo, no con el nombre (CIE-7, valor por defecto).
 *  6. La pantalla opera la jornada más vieja sin cerrar entre las últimas 100; si no hay, la de hoy (DEC-0512, confirmada el 21/11/2026).
 *  7. Los controles de stock no se muestran y un control sin texto aprobado hace fallar la pantalla entera con el genérico (DEC-0514, confirmada el 21/11/2026). Producción y stock en el cierre son CD-5, todavía sin hacer.
 *  8. Con el día en cierre o cerrado, Caja y Venta avisan «El día está en cierre. Cancelá el cierre para seguir» y «El día ya está cerrado» (CD-4, `cierre.error.en_cierre` y `cierre.error.cerrada`); esta pantalla, con un rechazo
 *     de negocio, muestra el genérico (el único aviso propio es «Cambió algo mientras mirabas…»).
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace:
    | Readonly<{ envia: ClaveAccion }>
    | "cambia-de-paso"
    | "marca-sin-enviar"
    | "abre-el-cuadro"
    | "vuelve";
  /** El botón se apaga sin la acción de permiso (una ayuda): decide el servidor al enviar y su respuesta se muestra. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeCierreDelDia = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  estados: Readonly<
    Record<
      "ABIERTA" | "EN_CIERRE" | "CERRADA" | "RECHAZO_DE_NEGOCIO" | "CONTROLES_CAMBIARON",
      ClaveDeTexto
    >
  >;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DEL_DUENO: FuenteDeTexto = {
  decidio:
    "el dueño, 14/11/2026 (filas 123 y 126, textos «tal cual»), con la maqueta aceptada por delegación (filas 173 y 174, fila 183) y la decisión del 21/11/2026 sobre el avance entre pasos; decisiones-del-dueno-2026-11.md",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta cierre-del-dia.html (abierta, impedimentos, en-cierre, corregir, conciliacion, reconocer, bloqueos, lista, diferencia, cambiaron, cerrada, sin-permiso); brief CD v2",
};
const REUSADO: FuenteDeTexto = {
  decidio:
    "el dueño: texto ya aprobado en su módulo y reutilizado por la maqueta del cierre (una regla, un lugar; decisión del 21/11/2026)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta cierre-del-dia.html (tabla «reutilizados»); catálogos de caja, ventas y catalogo",
};
const USO = "apps/web/ui/plantillas/cierre/";

export const FICHA_DE_CIERRE_DEL_DIA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/caja/cierre-del-dia/page.tsx",
    "apps/web/app/s/app/acciones-de-cierre-del-dia.ts",
    "apps/web/servidor/cierre-del-dia.ts",
    "apps/web/servidor/ofertas-de-cierre.ts",
    "apps/web/ui/plantillas/cierre/PantallaDelCierre.cliente.tsx",
    "apps/web/ui/plantillas/cierre/PuntosDelCierre.tsx",
    "apps/web/ui/plantillas/cierre/GrupoDeControles.tsx",
    "apps/web/ui/plantillas/cierre/ListaDeCobros.tsx",
    "apps/web/ui/plantillas/cierre/LineaDeConciliacion.cliente.tsx",
    "apps/web/ui/plantillas/cierre/ModalDeReconocer.cliente.tsx",
    "apps/web/ui/plantillas/cierre/ModalDeCorregirMedio.cliente.tsx",
    "apps/web/ui/plantillas/cierre/BotonDeAccionDelCierre.cliente.tsx",
    "apps/web/ui/plantillas/cierre/modelo-del-cierre.ts",
    "src/composicion/cierre-del-dia-web.ts",
    "src/composicion/lectura-del-cierre.ts",
    "src/composicion/entradas-de-cierre.ts",
    "src/composicion/errores-de-cierre.ts",
  ],
  rutas: ["/caja/cierre-del-dia"],
  botones: [
    {
      id: "empezar-el-cierre",
      texto: "cierre.accion.iniciar",
      hace: { envia: "jornadas.iniciar_auditoria" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar-el-cierre",
      texto: "caja.sesion.cancelar_cierre",
      hace: { envia: "jornadas.cancelar_auditoria" },
      sinPermiso: "APAGADO",
    },
    {
      id: "ir-a-la-conciliacion",
      texto: "cierre.control.conciliacion_por_medio",
      hace: "cambia-de-paso",
      sinPermiso: "APAGADO",
    },
    {
      id: "ir-a-reconocer",
      texto: "cierre.severidad.reconocible",
      hace: "cambia-de-paso",
      sinPermiso: "APAGADO",
    },
    {
      id: "paso-anterior",
      texto: "ventas.ticket.volver",
      hace: "cambia-de-paso",
      sinPermiso: "APAGADO",
    },
    {
      id: "corregir-medio",
      texto: "cierre.corregir_medio",
      hace: "abre-el-cuadro",
      sinPermiso: "APAGADO",
    },
    {
      id: "corregir-medio-guardar",
      texto: "caja.accion.guardar",
      hace: { envia: "cobros.corregir_medio" },
      sinPermiso: "APAGADO",
    },
    {
      id: "corregir-medio-cancelar",
      texto: "catalogo.accion.cancelar",
      hace: "vuelve",
      sinPermiso: "APAGADO",
    },
    {
      id: "declarar-el-total",
      texto: "caja.accion.guardar",
      hace: { envia: "declaraciones_de_total.registrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "conforme-general",
      texto: "caja.conforme_general",
      hace: { envia: "declaraciones_de_total.registrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reconocer",
      texto: "cierre.reconocer",
      hace: "abre-el-cuadro",
      sinPermiso: "APAGADO",
    },
    {
      id: "reconocer-marcar",
      texto: "cierre.reconocer",
      hace: "marca-sin-enviar",
      sinPermiso: "APAGADO",
    },
    {
      id: "reconocer-cancelar",
      texto: "catalogo.accion.cancelar",
      hace: "vuelve",
      sinPermiso: "APAGADO",
    },
    {
      id: "cerrar-el-dia",
      texto: "cierre.accion.cerrar",
      hace: { envia: "jornadas.cerrar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: {
    ABIERTA: "caja.estado.abierta",
    EN_CIERRE: "cierre.estado.en_auditoria",
    CERRADA: "caja.estado.cerrada",
    RECHAZO_DE_NEGOCIO: "cierre.error.accion_no_permitida",
    CONTROLES_CAMBIARON: "cierre.error.controles_cambiaron",
  },
  textos: {
    "cierre.titulo": { usos: ["título de la pantalla y fila del menú «Caja»"], fuente: DEL_DUENO },
    "cierre.estado.en_auditoria": {
      usos: [`${USO}modelo-del-cierre.ts`, "etiqueta de la jornada en cierre"],
      fuente: DEL_DUENO,
    },
    "cierre.accion.iniciar": { usos: ["botón de la jornada abierta"], fuente: DEL_DUENO },
    "cierre.accion.cerrar": { usos: ["botón del último paso"], fuente: DEL_DUENO },
    "cierre.severidad.bloquea": { usos: ["título del grupo «Impide cerrar»"], fuente: DEL_DUENO },
    "cierre.severidad.reconocible": {
      usos: ["título del grupo del paso 3 y botón de avance del paso 2"],
      fuente: DEL_DUENO,
    },
    "cierre.severidad.informa": {
      usos: ["título del grupo plegado «Solo informa»"],
      fuente: DEL_DUENO,
    },
    "cierre.control.conciliacion_por_medio": {
      usos: ["control, título del paso 2 y botón de avance del paso 1"],
      fuente: DEL_DUENO,
    },
    "cierre.reconocer": {
      usos: ["botón por control y de la hoja de reconocer"],
      fuente: DEL_DUENO,
    },
    "cierre.reconocido_por": {
      usos: ["control reconocido, con el día cerrado"],
      fuente: DEL_DUENO,
    },
    "cierre.cerrada_por": { usos: ["franja «Cerrada»: quién y cuándo"], fuente: DEL_DUENO },
    "cierre.conciliacion.registrado": { usos: ["línea de conciliación"], fuente: DEL_DUENO },
    "cierre.conciliacion.correcciones": {
      usos: ["línea de conciliación, solo si hubo correcciones"],
      fuente: DEL_DUENO,
    },
    "cierre.conciliacion.declarado": { usos: ["campo y línea de conciliación"], fuente: DEL_DUENO },
    "cierre.corregir_medio": { usos: ["botón por cobro y título de la hoja"], fuente: DEL_DUENO },
    "cierre.medio_correcto": { usos: ["campo de la hoja «Corregir medio»"], fuente: DEL_DUENO },
    "cierre.corregido_por": { usos: ["línea de un cobro corregido"], fuente: DEL_DUENO },
    "cierre.ticket_numero": { usos: ["línea «Cobrado contra el ticket»"], fuente: DEL_DUENO },
    "cierre.error.accion_no_permitida": {
      usos: ["aviso de cualquier rechazo de negocio de la pantalla"],
      fuente: DEL_DUENO,
    },
    "cierre.error.controles_cambiaron": {
      usos: ["aviso propio al cerrar con controles que cambiaron"],
      fuente: DEL_DUENO,
    },
    "caja.estado.abierta": { usos: ["etiqueta de la jornada abierta"], fuente: REUSADO },
    "caja.estado.cerrada": { usos: ["etiqueta y franja de la jornada cerrada"], fuente: REUSADO },
    "caja.sesion.jornada": { usos: ["cabecera «Jornada {fecha}»"], fuente: REUSADO },
    "caja.sesion.cancelar_cierre": { usos: ["botón «Cancelar cierre»"], fuente: REUSADO },
    "caja.arqueo.diferencia": {
      usos: ["línea de conciliación y de «Cobrado contra el ticket»"],
      fuente: REUSADO,
    },
    "caja.conforme": { usos: ["línea de conciliación conforme"], fuente: REUSADO },
    "caja.sin_declarar": { usos: ["línea de conciliación sin declarar"], fuente: REUSADO },
    "caja.conforme_general": { usos: ["botón del paso 2"], fuente: REUSADO },
    "caja.sin_cuenta": { usos: ["opción de la hoja «Corregir medio»"], fuente: REUSADO },
    "caja.accion.guardar": {
      usos: ["«Guardar» de la hoja y de cada línea declarable"],
      fuente: REUSADO,
    },
    "caja.arqueo.observacion_opcional": { usos: ["campo de la hoja «Reconocer»"], fuente: REUSADO },
    "ventas.ticket.cobros": { usos: ["título del paso 1 y del bloque plegado"], fuente: REUSADO },
    "ventas.ticket.motivo": { usos: ["campo de la hoja «Corregir medio»"], fuente: REUSADO },
    "ventas.ticket.volver": {
      usos: ["etiqueta accesible de la flecha «‹» de los pasos 2 y 3"],
      fuente: REUSADO,
    },
    "ventas.cobro.cuenta_de_cobro": {
      usos: ["campo de la hoja «Corregir medio»"],
      fuente: REUSADO,
    },
    "catalogo.accion.cancelar": { usos: ["«Cancelar» de las dos hojas"], fuente: REUSADO },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeCierreDelDia;
