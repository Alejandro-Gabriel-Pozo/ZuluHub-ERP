import { describe, expect, it } from "vitest";
import { TEXTOS_DE_PLATAFORMA } from "./textos-de-plataforma";

/**
 * Los textos de la consola de plataforma (pantallas «Planes» y «Política de cambio de plan»): el texto de cada clave es el de la tabla §8 del brief o el de la maqueta, y ninguno cambia sin que esta prueba lo diga. Cada uno declara
 * los marcadores que usa (ni uno de más ni uno de menos), sus usos y su fuente. Previene: un texto que cambia sin pasar por quien lo aprueba y un marcador que el texto usa y la clave no declara.
 */
const APROBADOS: Readonly<Record<string, string>> = {
  "plataforma.menu.planes": "Planes",
  "plataforma.arrepentir.puede_hasta": "Se puede deshacer hasta el {fecha}.",
  "plataforma.arrepentir.etiqueta_suba": "Suba",
  "plataforma.arrepentir.etiqueta_baja": "Baja",
  "plataforma.arrepentir.deshecho": "Deshecho por arrepentimiento",
  "plataforma.arrepentir.boton": "Deshacer por arrepentimiento",
  "plataforma.arrepentir.vuelve": "La empresa vuelve al plan {plan} desde el {fecha}.",
  "plataforma.arrepentir.consecuencia_baja":
    "La baja no se aplica: la empresa sigue con el plan que tiene.",
  "plataforma.arrepentir.consecuencia_suba":
    "La suba no se aplica: la empresa vuelve al plan anterior y los módulos nuevos quedan en solo lectura con lo cargado.",
  "plataforma.arrepentir.no_se_repite": "Un cambio deshecho no se puede deshacer de nuevo.",
  "plataforma.arrepentir.del_cambio": "Arrepentimiento del cambio del {fecha}",
  "plataforma.arrepentir.minima_suba": "Fecha mínima: hoy más {n} días de anticipación de suba.",
  "plataforma.arrepentir.minima_baja":
    "Fecha mínima: hoy más {n} días (el mayor entre la anticipación de baja y el plazo de arrepentimiento).",
  "plataforma.arrepentir.falta_anticipacion":
    "Falta anticipación. La primera fecha posible es el {fecha}.",
  "plataforma.arrepentir.no_es_el_ultimo":
    "Hubo un cambio posterior: solo se puede deshacer el último.",
  "plataforma.arrepentir.sin_arrepentimiento": "Este cambio no admite arrepentimiento.",
  "plataforma.arrepentir.plazo_vencido": "Venció el plazo para deshacer este cambio.",
  "plataforma.arrepentir.ya_arrepentido": "Este cambio ya se deshizo.",
  "plataforma.menu.politica": "Política de cambio de plan",
  "plataforma.politica.titulo": "Política de cambio de plan",
  "plataforma.politica.rotulo_suba": "Anticipación de una suba",
  "plataforma.politica.rotulo_baja": "Anticipación de una baja",
  "plataforma.politica.rotulo_arrepentimiento": "Plazo de arrepentimiento",
  "plataforma.politica.unidad_dia": "día",
  "plataforma.politica.unidad_dias": "días",
  "plataforma.politica.pie_vigente": "Definida por {persona} el {fecha}. Motivo: {motivo}",
  "plataforma.politica.historial": "Historial",
  "plataforma.politica.col_fecha": "Fecha",
  "plataforma.politica.col_suba": "Suba",
  "plataforma.politica.col_baja": "Baja",
  "plataforma.politica.col_arrepentimiento": "Arrepentimiento",
  "plataforma.politica.col_definida_por": "Definida por",
  "plataforma.politica.col_motivo": "Motivo",
  "plataforma.politica.definir": "Definir versión nueva",
  "plataforma.politica.falta_dias": "Ingresá un número entero de días entre 0 y 365.",
  "plataforma.politica.falta_motivo": "Falta el motivo.",
  "plataforma.politica.motivo_largo": "El motivo es demasiado largo.",
  "plataforma.politica.guardar": "Guardar versión nueva",
  "plataforma.politica.resumen": "Antes: {antes}. Después: {despues}.",
  "plataforma.politica.no_modifica": "Los cambios de plan ya registrados no se modifican.",
  "plataforma.politica.guardada": "Versión guardada.",
  "plataforma.politica.conflicto":
    "Otra persona cambió la política mientras tanto. Volvé a cargarla.",
  "plataforma.planes.titulo": "Planes",
  "plataforma.planes.nuevo_plan": "Nuevo plan",
  "plataforma.planes.crear_plan": "Crear plan",
  "plataforma.planes.campo_codigo": "Código del plan",
  "plataforma.planes.ayuda_codigo":
    "Minúsculas, números y guion; de 2 a 40; empieza con letra. No se puede cambiar.",
  "plataforma.planes.col_plan": "Plan",
  "plataforma.planes.col_ultima": "Última versión publicada",
  "plataforma.planes.col_borrador": "Borrador",
  "plataforma.planes.col_clientes": "Clientes con el plan",
  "plataforma.planes.col_estado": "Estado",
  "plataforma.planes.col_version": "Versión",
  "plataforma.planes.col_clientes_version": "Clientes con la versión",
  "plataforma.planes.col_valor": "Valor",
  "plataforma.planes.col_origen": "Origen",
  "plataforma.planes.col_incluido": "Incluido",
  "plataforma.planes.col_perilla": "Perilla",
  "plataforma.planes.col_modulo": "Módulo",
  "plataforma.planes.sin_planes": "Todavía no hay planes.",
  "plataforma.planes.hay_borrador": "Hay un borrador",
  "plataforma.planes.ninguna": "Ninguna",
  "plataforma.planes.estado_activo": "Activo",
  "plataforma.planes.estado_retirado": "Retirado",
  "plataforma.planes.version_borrador": "Borrador",
  "plataforma.planes.version_publicada": "Publicada",
  "plataforma.planes.versiones": "Versiones",
  "plataforma.planes.nueva_version": "Nueva versión desde la v{n}",
  "plataforma.planes.nueva_version_sin_base": "Nueva versión",
  "plataforma.planes.editar_borrador": "Editar el borrador",
  "plataforma.planes.nombre_comercial": "Nombre comercial",
  "plataforma.planes.modulos": "Módulos",
  "plataforma.planes.perillas": "Límites y funciones extra",
  "plataforma.planes.siempre_incluido": "Siempre incluido",
  "plataforma.planes.requiere": "Requiere {modulos}",
  "plataforma.planes.lo_pide_otro": "Lo pide otro módulo del plan",
  "plataforma.planes.en_desarrollo": "En desarrollo",
  "plataforma.planes.advertencia_perilla":
    "La perilla «{perilla}» pertenece al módulo {modulo}, que este plan no incluye.",
  "plataforma.planes.revisar_antes": "Revisá antes de publicar",
  "plataforma.planes.que_cambia": "Qué cambia respecto de la v{n}",
  "plataforma.planes.que_cambio": "Qué cambió respecto de la v{n}",
  "plataforma.planes.dif_suma": "Se suma el módulo {m}",
  "plataforma.planes.dif_quita": "Se quita el módulo {m}",
  "plataforma.planes.dif_perilla": "{perilla}: de {a} a {b}",
  "plataforma.planes.sin_cambios": "Sin cambios.",
  "plataforma.planes.guardar": "Guardar borrador",
  "plataforma.planes.borrador_guardado": "Borrador guardado.",
  "plataforma.planes.publicar": "Publicar",
  "plataforma.planes.publicar_abrir": "Publicar…",
  "plataforma.planes.publicar_titulo": "Publicar la versión",
  "plataforma.planes.publicar_resumen":
    "Se publica la v{n} del plan {codigo}. Queda congelada: después no se puede modificar, solo agregar otra versión.",
  "plataforma.planes.motivo": "Motivo",
  "plataforma.planes.motivo_ayuda": "Queda en el historial del plan.",
  "plataforma.planes.publicada_aviso":
    "Versión v{n} publicada. Ningún cliente cambió: para que una empresa la use hay que asignársela desde su plan.",
  "plataforma.planes.ficha_aviso":
    "Publicar una versión no cambia el plan de ninguna empresa: cada cliente sigue con la versión que tiene hasta que se le asigne otra.",
  "plataforma.planes.sin_borrador":
    "Esta versión ya no tiene borrador: otra persona la publicó antes. Revisá las versiones del plan.",
  "plataforma.planes.falta_nombre": "Falta el nombre comercial.",
  "plataforma.planes.falta_motivo": "Falta el motivo.",
  "plataforma.planes.codigo_invalido": "El código no es válido.",
  "plataforma.planes.version_vieja": "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
  "plataforma.planes.no_permitido": "Esta acción no está permitida",
  "plataforma.planes.clientes_con_version": "Clientes con esta versión",
  "plataforma.planes.sin_clientes": "Ningún cliente tiene esta versión.",
  "plataforma.planes.volver": "Volver al plan",
  "plataforma.planes.cancelar": "Cancelar",
  "plataforma.planes.si": "Sí",
  "plataforma.planes.no": "No",
  "plataforma.planes.valor_encendida": "Encendida",
  "plataforma.planes.valor_apagada": "Apagada",
  "plataforma.planes.origen_base": "Base",
  "plataforma.planes.origen_plan": "Fijado por el plan",
  "plataforma.planes.version_inmutable": "Una versión publicada no se modifica.",
  "plataforma.planes.publicada_por": "{nombre} · publicada el {fecha} por {quien}",
  "plataforma.planes.motivo_de": "Motivo: {motivo}",
  "plataforma.planes.copiada_de": "Copiado de la v{n}. Un plan tiene a lo sumo un borrador.",
  "plataforma.planes.plan_creado": "Plan creado. Todavía no tiene versiones.",
  "plataforma.planes.plan_ya_existia": "El plan ya existía.",
};

describe("textos de la consola de plataforma", () => {
  it("son exactamente los aprobados, con el mismo texto", () => {
    expect(
      Object.fromEntries(Object.entries(TEXTOS_DE_PLATAFORMA).map(([k, d]) => [k, d.porDefecto])),
    ).toEqual(APROBADOS);
  });

  it.each(Object.entries(TEXTOS_DE_PLATAFORMA))(
    "%s: marcadores declarados = marcadores del texto, usos y fuente",
    (_clave, definicion) => {
      const usados = [...definicion.porDefecto.matchAll(/\{([a-zA-Z]+)\}/g)]
        .map((m) => m[1])
        .sort();
      const declarados = "marcadores" in definicion ? [...definicion.marcadores].sort() : [];
      expect(declarados).toEqual(usados);
      expect(definicion.usos).toEqual(["DE_FICHA"]);
      // «Planes»: DEC-0805; «Política de cambio de plan» (T-1 a T-18): DEC-0814; «Deshacer por arrepentimiento» (T-19 a T-37): DEC-0817.
      expect(definicion.fuente).toEqual({
        decision: /^plataforma\.(menu\.politica|politica\.)/.test(_clave)
          ? "DEC-0814"
          : /^plataforma\.arrepentir\./.test(_clave)
            ? "DEC-0817"
            : "DEC-0805",
      });
    },
  );
});
