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
 * «Deshacer por arrepentimiento» y fecha mínima del cambio de plan (H-14b, parte 2). Fuente de todos: DEC-0817 (textos T-19 a T-37 que el dueño aprobó el 20/11/2026 con «h14b ok»,
 * `11-especificaciones/h14b-textos-aprobados.md` del repositorio de documentos). T-27 y T-28 reusan «Motivo» y «Falta el motivo.» de «Planes» (mismo texto).
 */
const A = (porDefecto: string, marcadores?: readonly string[]): DefinicionDeTexto => ({
  porDefecto,
  ...(marcadores === undefined ? {} : { marcadores }),
  usos: ["DE_FICHA"],
  fuente: { decision: "DEC-0817" },
});

export const TEXTOS_DE_PLATAFORMA = {
  "plataforma.menu.planes": T("Planes"),
  "plataforma.arrepentir.puede_hasta": A("Se puede deshacer hasta el {fecha}.", ["fecha"]), // T-19
  "plataforma.arrepentir.etiqueta_suba": A("Suba"), // T-20
  "plataforma.arrepentir.etiqueta_baja": A("Baja"), // T-21
  "plataforma.arrepentir.deshecho": A("Deshecho por arrepentimiento"), // T-22
  "plataforma.arrepentir.boton": A("Deshacer por arrepentimiento"), // T-23
  "plataforma.arrepentir.vuelve": A("La empresa vuelve al plan {plan} desde el {fecha}.", [
    "plan",
    "fecha",
  ]), // T-24
  "plataforma.arrepentir.consecuencia_baja": A(
    "La baja no se aplica: la empresa sigue con el plan que tiene.",
  ), // T-25
  // T-26: texto corregido y aprobado por el dueño (fila del 20/11/2026 «apruebo t26»); es la única clave de la consecuencia de deshacer una suba.
  "plataforma.arrepentir.consecuencia_suba": A(
    "La suba no se aplica: la empresa vuelve al plan anterior y los módulos nuevos quedan en solo lectura con lo cargado.",
  ), // T-26
  "plataforma.arrepentir.no_se_repite": A("Un cambio deshecho no se puede deshacer de nuevo."), // T-29
  "plataforma.arrepentir.del_cambio": A("Arrepentimiento del cambio del {fecha}", ["fecha"]), // T-30
  "plataforma.arrepentir.minima_suba": A(
    "Fecha mínima: hoy más {n} días de anticipación de suba.",
    ["n"],
  ), // T-31
  "plataforma.arrepentir.minima_baja": A(
    "Fecha mínima: hoy más {n} días (el mayor entre la anticipación de baja y el plazo de arrepentimiento).",
    ["n"],
  ), // T-32
  "plataforma.arrepentir.falta_anticipacion": A(
    "Falta anticipación. La primera fecha posible es el {fecha}.",
    ["fecha"],
  ), // T-33
  "plataforma.arrepentir.no_es_el_ultimo": A(
    "Hubo un cambio posterior: solo se puede deshacer el último.",
  ), // T-34
  "plataforma.arrepentir.sin_arrepentimiento": A("Este cambio no admite arrepentimiento."), // T-35
  "plataforma.arrepentir.plazo_vencido": A("Venció el plazo para deshacer este cambio."), // T-36
  "plataforma.arrepentir.ya_arrepentido": A("Este cambio ya se deshizo."), // T-37
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
