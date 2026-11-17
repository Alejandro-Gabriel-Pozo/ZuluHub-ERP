import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { vendeLaClase } from "../dominio/clases";
import type { GrupoConOpciones } from "../dominio/cotizar";
import { grupoDeEleccionesId, type ProductoId } from "../dominio/identificadores";
import type { Opcion } from "../dominio/modelo";
import {
  validarConjuntoDeOpciones,
  type GrupoPedido,
  type GrupoValido,
  type OpcionValida,
} from "../dominio/opciones";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo, TxDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeEditarOpciones = Readonly<{
  productoId: string;
  /** La versión del conjunto de opciones que la pantalla tenía al abrir (`version_de_opciones` del producto). */
  versionDeOpcionesEsperada: number;
  /** El conjunto FINAL de grupos del producto: lo que no figura queda desactivado (nada se borra). */
  grupos: readonly GrupoPedido[];
}>;

export type SalidaDeEditarOpciones = Readonly<{ versionDeOpciones: number; yaEstaba: boolean }>;

type CambioDeGrupo = Readonly<{ valido: GrupoValido; actual: GrupoConOpciones | null }>;

const mismaOpcion = (actual: Opcion, pedida: OpcionValida): boolean =>
  actual.nombre === pedida.nombre &&
  actual.recargo === pedida.recargo &&
  actual.factorDeTamano === pedida.factorDeTamano;

/**
 * El grupo pedido, comparado con el guardado: ¿hay algo para escribir? (`true` si el grupo es nuevo, cambia o cambia alguna de sus opciones).
 * Lo que el conjunto final no nombra se desactiva, así que «ya está desactivado» también cuenta como igual.
 */
function grupoCambia(valido: GrupoValido, actual: GrupoConOpciones | null): boolean {
  if (actual === null) return true;
  const g = actual.grupo;
  if (
    g.nombre !== valido.nombre ||
    g.esTamano !== valido.esTamano ||
    g.esObligatorio !== valido.esObligatorio ||
    g.admiteVarias !== valido.admiteVarias ||
    g.seMuestraEnCarta !== valido.seMuestraEnCarta ||
    g.orden !== valido.orden ||
    g.activo !== valido.activo
  ) {
    return true;
  }
  const pedidas = new Map(valido.opciones.map((o) => [o.id, o]));
  for (const o of actual.opciones) {
    const pedida = pedidas.get(o.id);
    if (
      pedida === undefined
        ? o.activa
        : o.orden !== pedida.orden || o.activa !== pedida.activa || !mismaOpcion(o, pedida)
    )
      return true;
  }
  return valido.opciones.some((p) => !actual.opciones.some((o) => o.id === p.id));
}

async function escribirOpciones(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  producto: ProductoId,
  valido: GrupoValido,
  actual: GrupoConOpciones | null,
  todas: readonly GrupoConOpciones[],
  resumen: { opcionesCreadas: number; versionesNuevas: number; opcionesCambiadas: number },
): Promise<R<null>> {
  const { empresaId } = contexto;
  const grupoId = grupoDeEleccionesId(valido.id);
  const pedidas = new Set(valido.opciones.map((o) => o.id));
  for (const o of valido.opciones) {
    const guardada = actual === null ? undefined : actual.opciones.find((x) => x.id === o.id);
    if (guardada === undefined) {
      // Una opción que ya existe en OTRO grupo no se mueve: el id sería de otra cosa.
      if (todas.some((g) => g.opciones.some((x) => x.id === o.id))) return err("ID_REUTILIZADO");
      const id = await tx.opciones.insertarOpcion(empresaId, producto, grupoId, {
        id: o.id,
        nombreClave: o.nombreClave,
        orden: o.orden,
      });
      if (!o.activa) await tx.opciones.actualizarOpcion(empresaId, id, o.orden, false);
      await tx.opciones.insertarVersion(empresaId, {
        opcionId: id,
        numero: 1,
        nombre: o.nombre,
        recargo: o.recargo,
        factorDeTamano: o.factorDeTamano,
        cargadaPor: contexto.personaId,
        creadaEn: contexto.ahora,
      });
      resumen.opcionesCreadas += 1;
      continue;
    }
    if (guardada.orden !== o.orden || guardada.activa !== o.activa) {
      await tx.opciones.actualizarOpcion(empresaId, guardada.id, o.orden, o.activa);
      resumen.opcionesCambiadas += 1;
    }
    if (!mismaOpcion(guardada, o)) {
      // Una versión nueva copiando hacia adelante lo que consumía la anterior: no se pierde lo cargado.
      const versionId = await tx.opciones.insertarVersion(empresaId, {
        opcionId: guardada.id,
        numero: guardada.numero + 1,
        nombre: o.nombre,
        recargo: o.recargo,
        factorDeTamano: o.factorDeTamano,
        cargadaPor: contexto.personaId,
        creadaEn: contexto.ahora,
      });
      const lineas =
        (await tx.opciones.consumoDeVersiones(empresaId, [guardada.versionId])).get(
          guardada.versionId,
        ) ?? [];
      await tx.opciones.insertarConsumo(empresaId, versionId, lineas);
      resumen.versionesNuevas += 1;
    }
  }
  if (actual !== null) {
    for (const o of actual.opciones) {
      if (!pedidas.has(o.id) && o.activa) {
        await tx.opciones.actualizarOpcion(empresaId, o.id, o.orden, false);
        resumen.opcionesCambiadas += 1;
      }
    }
  }
  return ok(null);
}

/**
 * Editar el conjunto de opciones de un producto (§3.5; decisiones 82, 133, 138, 157, 159). Guard `opciones.editar` con alcance TODAS y, si
 * toca la variante, también `variantes.editar`. Bloquea el producto; que exista, esté activo y se venda. Valida el conjunto final (`dominio/opciones.ts`).
 * Repetición (`SIN_CAMBIOS`): si el conjunto pedido es igual al actual devuelve lo vigente aunque la versión esperada sea vieja (así un
 * reenvío tras un éxito no falla y no inserta versiones). Si no, compara `versionDeOpcionesEsperada` (`OPCIONES_DESACTUALIZADAS`) y aplica
 * en este orden: grupos que cambian (los que se desactivan primero: a lo sumo una variante activa), grupos nuevos, opciones. Una opción con nombre,
 * recargo o factor distinto inserta una versión nueva copiando hacia adelante lo que consumía. Quitar = desactivar; nada se borra. Cambiar los
 * datos de una opción de la variante no toca sus precios. Sube `version_de_opciones` (y, por el disparador, la versión del producto). Un grupo
 * adicional que pasa a no mostrarse en la carta con un recargo propio de sucursal vigente se rechaza (`ELECCION_OCULTA_CON_PRECIO`).
 */
export function armarEditarOpciones(dependencias: DependenciasDeCatalogo) {
  return async function editarOpciones(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarOpciones,
  ): Promise<R<SalidaDeEditarOpciones>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarOpciones>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["opciones.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const producto = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        if (!vendeLaClase(producto.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");
        const conjunto = validarConjuntoDeOpciones(entrada.grupos);
        if (!conjunto.ok) return conjunto;

        const actuales = await tx.opciones.gruposDelProducto(empresaId, producto.id);
        const cambios: CambioDeGrupo[] = [];
        for (const valido of conjunto.valor) {
          const actual = actuales.find((g) => g.grupo.id === valido.id) ?? null;
          if (actual !== null && actual.grupo.clase !== valido.clase)
            return err("CLASE_DE_GRUPO_INVALIDA");
          if (grupoCambia(valido, actual)) cambios.push({ valido, actual });
        }
        // Lo que el conjunto final no nombra se desactiva.
        const pedidos = new Set(conjunto.valor.map((g) => g.id));
        const quitados = actuales.filter((g) => !pedidos.has(g.grupo.id) && g.grupo.activo);
        if (cambios.length === 0 && quitados.length === 0) {
          return ok({ versionDeOpciones: producto.versionDeOpciones, yaEstaba: true });
        }
        if (entrada.versionDeOpcionesEsperada !== producto.versionDeOpciones)
          return err("OPCIONES_DESACTUALIZADAS");

        const tocaLaVariante =
          cambios.some((c) => c.valido.clase === "VARIANTE") ||
          quitados.some((g) => g.grupo.clase === "VARIANTE");
        if (tocaLaVariante) {
          const permisoDeVariante = await autorizar(tx, contexto, dependencias.reglas, [
            "variantes.editar",
          ]);
          if (!permisoDeVariante.ok) return permisoDeVariante;
        }
        // Un adicional que pasa a no mostrarse no puede dejar recargos propios de sucursal vigentes (K8).
        const ocultan = cambios.filter(
          (c) =>
            c.actual !== null &&
            c.actual.grupo.seMuestraEnCarta &&
            !c.valido.seMuestraEnCarta &&
            c.valido.clase === "ADICIONAL",
        );
        if (ocultan.length > 0) {
          const filas = await tx.precios.ultimasPorAlcance(empresaId, producto.id);
          for (const c of ocultan) {
            const ids = new Set((c.actual?.opciones ?? []).map((o) => o.id));
            if (
              filas.some(
                (f) =>
                  f.opcionId !== null &&
                  ids.has(f.opcionId) &&
                  f.sucursalId !== null &&
                  f.precio !== null,
              )
            ) {
              return err("ELECCION_OCULTA_CON_PRECIO");
            }
          }
        }

        const resumen = {
          gruposCreados: 0,
          gruposCambiados: 0,
          gruposQuitados: quitados.length,
          opcionesCreadas: 0,
          versionesNuevas: 0,
          opcionesCambiadas: 0,
        };
        // 1. Los grupos que ya existen y cambian, los que se desactivan primero (a lo sumo una variante activa); y los que quedaron afuera.
        const existentes = cambios
          .filter((c) => c.actual !== null)
          .sort((a, b) => Number(a.valido.activo) - Number(b.valido.activo));
        for (const g of quitados) {
          await tx.opciones.desactivarGrupo(empresaId, g.grupo.id);
        }
        for (const c of existentes) {
          await tx.opciones.actualizarGrupo(empresaId, c.valido);
          resumen.gruposCambiados += 1;
        }
        // 2. Los grupos nuevos.
        for (const c of cambios.filter((x) => x.actual === null)) {
          await tx.opciones.insertarGrupo(empresaId, producto.id, c.valido);
          resumen.gruposCreados += 1;
        }
        // 3. Sus opciones.
        for (const c of cambios) {
          const hecho = await escribirOpciones(
            tx,
            contexto,
            producto.id,
            c.valido,
            c.actual,
            actuales,
            resumen,
          );
          if (!hecho.ok) return hecho;
        }
        const subido = await tx.productos.subirVersionDeOpciones(empresaId, producto.id);
        if (subido === null) return err("PRODUCTO_NO_ENCONTRADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "OPCIONES_EDITADAS",
          entidad: "producto",
          entidadId: producto.id,
          antes: { versionDeOpciones: producto.versionDeOpciones },
          despues: { versionDeOpciones: subido.versionDeOpciones, ...resumen },
        });
        return ok({ versionDeOpciones: subido.versionDeOpciones, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
