import type { DefinicionDeTexto } from "./catalogo";

/**
 * Los textos de la consola de plataforma (prefijo `plataforma.`). A PROPÓSITO no se suman a `CATALOGO_DE_TEXTOS`: ese catálogo es el vocabulario que una marca puede reemplazar (`catalogosDeMarca`
 * lo ofrece entero al editor de submarcas) y la consola no es de ninguna marca. Previene: que los textos internos de la plataforma aparezcan como reemplazables en el vocabulario de un cliente
 * (`test/web/ficha-de-planes-de-consola.test.ts` exige que ninguna clave de acá esté en el catálogo de las marcas).
 *
 * «Planes» (brief `Pedernal-docs 11-especificaciones/briefs/plataforma/PR-planes-consola.md` §8 y maqueta `10-ux-ui/prototipos-plataforma/planes.html`). Fuente de todos: DEC-0805 (inventario de textos
 * de Planes; delegación fila 173). Los marcados «maqueta» están en la maqueta y no en la tabla §8 del brief.
 */
const T = (porDefecto: string, marcadores?: readonly string[]): DefinicionDeTexto => ({
  porDefecto,
  ...(marcadores === undefined ? {} : { marcadores }),
  usos: ["DE_FICHA"],
  fuente: { decision: "DEC-0805" },
});

/**
 * «Política de cambio de plan» (H-14b). Fuente de todos: DEC-0814 (los textos T-1 a T-18 que el dueño aprobó el 20/11/2026 con «h14b ok», `11-especificaciones/h14b-textos-aprobados.md` del repositorio de documentos).
 * El texto del error de versión desactualizada (T-38) no tiene clave propia: se reutiliza el que la consola ya tiene para ese código.
 */
const P = (porDefecto: string, marcadores?: readonly string[]): DefinicionDeTexto => ({
  porDefecto,
  ...(marcadores === undefined ? {} : { marcadores }),
  usos: ["DE_FICHA"],
  fuente: { decision: "DEC-0814" },
});

export const TEXTOS_DE_PLATAFORMA = {
  "plataforma.menu.planes": T("Planes"),
  "plataforma.menu.politica": P("Política de cambio de plan"), // T-1
  "plataforma.politica.titulo": P("Política de cambio de plan"), // T-2
  "plataforma.politica.rotulo_suba": P("Anticipación de una suba"), // T-3
  "plataforma.politica.rotulo_baja": P("Anticipación de una baja"), // T-4
  "plataforma.politica.rotulo_arrepentimiento": P("Plazo de arrepentimiento"), // T-5
  "plataforma.politica.unidad_dia": P("día"), // T-6
  "plataforma.politica.unidad_dias": P("días"), // T-6
  "plataforma.politica.pie_vigente": P("Definida por {persona} el {fecha}. Motivo: {motivo}", [
    "persona",
    "fecha",
    "motivo",
  ]), // T-7
  "plataforma.politica.historial": P("Historial"), // T-8
  "plataforma.politica.col_fecha": P("Fecha"), // T-9
  "plataforma.politica.col_suba": P("Suba"), // T-9
  "plataforma.politica.col_baja": P("Baja"), // T-9
  "plataforma.politica.col_arrepentimiento": P("Arrepentimiento"), // T-9
  "plataforma.politica.col_definida_por": P("Definida por"), // T-9
  "plataforma.politica.col_motivo": P("Motivo"), // T-9
  "plataforma.politica.definir": P("Definir versión nueva"), // T-10
  "plataforma.politica.falta_dias": P("Ingresá un número entero de días entre 0 y 365."), // T-11
  "plataforma.politica.falta_motivo": P("Falta el motivo."), // T-12
  "plataforma.politica.motivo_largo": P("El motivo es demasiado largo."), // T-13
  "plataforma.politica.guardar": P("Guardar versión nueva"), // T-14
  "plataforma.politica.resumen": P("Antes: {antes}. Después: {despues}.", ["antes", "despues"]), // T-15
  "plataforma.politica.no_modifica": P("Los cambios de plan ya registrados no se modifican."), // T-16
  "plataforma.politica.guardada": P("Versión guardada."), // T-17
  "plataforma.politica.conflicto": P(
    "Otra persona cambió la política mientras tanto. Volvé a cargarla.",
  ), // T-18
  "plataforma.planes.titulo": T("Planes"),
  "plataforma.planes.nuevo_plan": T("Nuevo plan"),
  "plataforma.planes.crear_plan": T("Crear plan"), // maqueta
  "plataforma.planes.campo_codigo": T("Código del plan"),
  "plataforma.planes.ayuda_codigo": T(
    "Minúsculas, números y guion; de 2 a 40; empieza con letra. No se puede cambiar.",
  ),
  "plataforma.planes.col_plan": T("Plan"),
  "plataforma.planes.col_ultima": T("Última versión publicada"),
  "plataforma.planes.col_borrador": T("Borrador"),
  "plataforma.planes.col_clientes": T("Clientes con el plan"),
  "plataforma.planes.col_estado": T("Estado"),
  "plataforma.planes.col_version": T("Versión"), // maqueta
  "plataforma.planes.col_clientes_version": T("Clientes con la versión"), // maqueta
  "plataforma.planes.col_valor": T("Valor"), // maqueta
  "plataforma.planes.col_origen": T("Origen"), // maqueta
  "plataforma.planes.col_incluido": T("Incluido"), // maqueta
  "plataforma.planes.col_perilla": T("Perilla"), // maqueta
  "plataforma.planes.col_modulo": T("Módulo"), // maqueta
  "plataforma.planes.sin_planes": T("Todavía no hay planes."), // nuevo: refleja «Todavía no hay submarcas.»
  "plataforma.planes.hay_borrador": T("Hay un borrador"), // maqueta
  "plataforma.planes.ninguna": T("Ninguna"), // maqueta
  "plataforma.planes.estado_activo": T("Activo"),
  "plataforma.planes.estado_retirado": T("Retirado"),
  "plataforma.planes.version_borrador": T("Borrador"),
  "plataforma.planes.version_publicada": T("Publicada"),
  "plataforma.planes.versiones": T("Versiones"),
  "plataforma.planes.nueva_version": T("Nueva versión desde la v{n}", ["n"]),
  "plataforma.planes.nueva_version_sin_base": T("Nueva versión"), // maqueta
  "plataforma.planes.editar_borrador": T("Editar el borrador"),
  "plataforma.planes.nombre_comercial": T("Nombre comercial"),
  "plataforma.planes.modulos": T("Módulos"),
  "plataforma.planes.perillas": T("Límites y funciones extra"),
  "plataforma.planes.siempre_incluido": T("Siempre incluido"),
  "plataforma.planes.requiere": T("Requiere {modulos}", ["modulos"]),
  "plataforma.planes.lo_pide_otro": T("Lo pide otro módulo del plan"), // maqueta
  "plataforma.planes.en_desarrollo": T("En desarrollo"),
  "plataforma.planes.advertencia_perilla": T(
    "La perilla «{perilla}» pertenece al módulo {modulo}, que este plan no incluye.",
    ["perilla", "modulo"],
  ),
  "plataforma.planes.revisar_antes": T("Revisá antes de publicar"), // maqueta
  "plataforma.planes.que_cambia": T("Qué cambia respecto de la v{n}", ["n"]),
  "plataforma.planes.que_cambio": T("Qué cambió respecto de la v{n}", ["n"]), // maqueta
  "plataforma.planes.dif_suma": T("Se suma el módulo {m}", ["m"]),
  "plataforma.planes.dif_quita": T("Se quita el módulo {m}", ["m"]),
  "plataforma.planes.dif_perilla": T("{perilla}: de {a} a {b}", ["perilla", "a", "b"]),
  "plataforma.planes.sin_cambios": T("Sin cambios."),
  "plataforma.planes.guardar": T("Guardar borrador"),
  "plataforma.planes.borrador_guardado": T("Borrador guardado."), // maqueta
  "plataforma.planes.publicar": T("Publicar"),
  "plataforma.planes.publicar_abrir": T("Publicar…"), // maqueta
  "plataforma.planes.publicar_titulo": T("Publicar la versión"), // maqueta
  "plataforma.planes.publicar_resumen": T(
    "Se publica la v{n} del plan {codigo}. Queda congelada: después no se puede modificar, solo agregar otra versión.",
    ["n", "codigo"],
  ),
  "plataforma.planes.motivo": T("Motivo"),
  "plataforma.planes.motivo_ayuda": T("Queda en el historial del plan."), // maqueta
  "plataforma.planes.publicada_aviso": T(
    "Versión v{n} publicada. Ningún cliente cambió: para que una empresa la use hay que asignársela desde su plan.",
    ["n"],
  ),
  "plataforma.planes.ficha_aviso": T(
    "Publicar una versión no cambia el plan de ninguna empresa: cada cliente sigue con la versión que tiene hasta que se le asigne otra.",
  ),
  "plataforma.planes.sin_borrador": T(
    "Esta versión ya no tiene borrador: otra persona la publicó antes. Revisá las versiones del plan.",
  ),
  "plataforma.planes.falta_nombre": T("Falta el nombre comercial."),
  "plataforma.planes.falta_motivo": T("Falta el motivo."),
  "plataforma.planes.codigo_invalido": T("El código no es válido."),
  "plataforma.planes.version_vieja": T(
    "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
  ),
  "plataforma.planes.no_permitido": T("Esta acción no está permitida"),
  "plataforma.planes.clientes_con_version": T("Clientes con esta versión"),
  "plataforma.planes.sin_clientes": T("Ningún cliente tiene esta versión."), // tabla §8, misma fila
  "plataforma.planes.volver": T("Volver al plan"), // maqueta
  "plataforma.planes.cancelar": T("Cancelar"), // maqueta
  "plataforma.planes.si": T("Sí"), // maqueta
  "plataforma.planes.no": T("No"), // maqueta
  "plataforma.planes.valor_encendida": T("Encendida"), // maqueta
  "plataforma.planes.valor_apagada": T("Apagada"), // maqueta
  "plataforma.planes.origen_base": T("Base"), // maqueta
  "plataforma.planes.origen_plan": T("Fijado por el plan"), // maqueta
  "plataforma.planes.version_inmutable": T("Una versión publicada no se modifica."), // maqueta
  "plataforma.planes.publicada_por": T("{nombre} · publicada el {fecha} por {quien}", [
    "nombre",
    "fecha",
    "quien",
  ]), // maqueta
  "plataforma.planes.motivo_de": T("Motivo: {motivo}", ["motivo"]), // maqueta
  "plataforma.planes.copiada_de": T("Copiado de la v{n}. Un plan tiene a lo sumo un borrador.", [
    "n",
  ]), // maqueta
  "plataforma.planes.plan_creado": T("Plan creado. Todavía no tiene versiones."), // maqueta
  "plataforma.planes.plan_ya_existia": T("El plan ya existía."), // maqueta
} as const satisfies Readonly<Record<string, DefinicionDeTexto>>;

export type ClaveDeTextoDePlataforma = keyof typeof TEXTOS_DE_PLATAFORMA;
