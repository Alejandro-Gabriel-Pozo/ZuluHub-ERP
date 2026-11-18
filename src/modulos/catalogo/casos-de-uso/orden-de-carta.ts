import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { vendeLaClase } from "../dominio/clases";
import { esUuid } from "../dominio/identificadores";
import {
  renglonesDeSeccion,
  validarOrdenPedido,
  type TipoDeRenglon,
} from "../dominio/renglones-de-seccion";
import type { ModoDeOrden } from "../persistencia/repositorio-de-orden-de-carta";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** Tope de renglones de una sección (el de las secciones de una carta, 200, por cabeza de renglón; ver `reordenar-secciones.ts`). */
const MAXIMO_DE_RENGLONES = 1000;

export type EntradaDeOrdenarRenglones = Readonly<{
  seccionId: string;
  /** La versión del ORDEN de la sección que vio quien lo ordena. */
  versionDelOrdenEsperada: number;
  /** El estado que se quiere: «ALFABETICO» (por defecto) o «A_MANO». */
  modo: ModoDeOrden;
  /** Con «A_MANO»: TODOS los renglones de la sección, una vez cada uno, en el orden nuevo. Con «ALFABETICO» no se manda. */
  renglones?: readonly Readonly<{ tipo: TipoDeRenglon; id: string }>[];
}>;
export type SalidaDeOrdenarRenglones = Readonly<{
  versionDelOrden: number;
  /** `true` si ya estaba así: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
  /** Cuántos renglones cambiaron de lugar. */
  movidos: number;
}>;

export type EntradaDeDestacarRenglon = Readonly<{
  tipo: TipoDeRenglon;
  id: string;
  /** El estado que se quiere (no alterna). Sin tope de estrellas (DDD 68). */
  destacado: boolean;
}>;
export type SalidaDeDestacarRenglon = Readonly<{ yaEstaba: boolean }>;

/**
 * Orden de los renglones de una sección de la carta (A8, CU-F8): por EMPRESA (DDD 69). Acción `productos.editar` con alcance TODAS (igual que reordenar secciones). La
 * sección se toma `FOR UPDATE`: dos reordenamientos a la vez se ponen en fila. Pide el ESTADO deseado: si ya está así (mismo modo y mismo orden) es `yaEstaba` sin escribir ni
 * auditar, aunque la versión sea vieja. Con «A_MANO» la lista tiene que ser EXACTAMENTE los renglones de la sección (las familias agrupadas y los productos sueltos); si
 * falta o sobra uno, `LISTA_DE_RENGLONES_INCOMPLETA`/`RENGLON_NO_ENCONTRADO`; repetido, `RENGLON_REPETIDO`. Una versión vieja del orden se rechaza entera
 * (`VERSION_DESACTUALIZADA`). Todo o nada, con auditoría.
 */
export function armarOrdenarRenglonesDeSeccion(dependencias: DependenciasDeCatalogo) {
  return async function ordenarRenglonesDeSeccion(
    contexto: ContextoOperativo,
    entrada: EntradaDeOrdenarRenglones,
  ): Promise<R<SalidaDeOrdenarRenglones>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeOrdenarRenglones>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.seccionId)) return err("IDENTIFICADOR_INVALIDO");
        if (entrada.modo !== "ALFABETICO" && entrada.modo !== "A_MANO")
          return err("MODO_DE_ORDEN_INVALIDO");
        if (
          !Number.isInteger(entrada.versionDelOrdenEsperada) ||
          entrada.versionDelOrdenEsperada < 1
        )
          return err("VERSION_DESACTUALIZADA");
        const pedidos = entrada.renglones ?? [];
        if (pedidos.length > MAXIMO_DE_RENGLONES) return err("ORDEN_INVALIDO");
        if (pedidos.some((r) => !esUuid(r.id) || (r.tipo !== "PRODUCTO" && r.tipo !== "FAMILIA")))
          return err("IDENTIFICADOR_INVALIDO");

        const seccion = await tx.familias.bloquearOrdenDeSeccion(empresaId, entrada.seccionId);
        if (seccion === null || !seccion.activa) return err("SECCION_NO_ENCONTRADA");

        if (entrada.modo === "ALFABETICO") {
          if (seccion.modo === "ALFABETICO")
            return ok({ versionDelOrden: seccion.version, yaEstaba: true, movidos: 0 });
          if (seccion.version !== entrada.versionDelOrdenEsperada)
            return err("VERSION_DESACTUALIZADA");
          const fijada = await tx.familias.fijarOrdenDeSeccion(
            empresaId,
            seccion.id,
            seccion.version,
            "ALFABETICO",
          );
          if (!fijada) return err("VERSION_DESACTUALIZADA");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "ORDEN_DE_CARTA_CAMBIADO",
            entidad: "seccion_de_carta",
            entidadId: seccion.id,
            antes: { modo: seccion.modo },
            despues: { modo: "ALFABETICO" },
          });
          return ok({ versionDelOrden: seccion.version + 1, yaEstaba: false, movidos: 0 });
        }

        const productos = await tx.familias.productosDeLaSeccion(empresaId, seccion.id);
        const familias = await tx.familias.familiasConMiembros(empresaId);
        const actuales = renglonesDeSeccion(seccion.id, productos, familias);
        const valido = validarOrdenPedido(actuales, pedidos);
        if (!valido.ok) return valido;

        const ordenGuardado = new Map<string, number | null>([
          ...productos.map((p) => [`PRODUCTO:${p.id}`, p.orden] as const),
          ...familias.map((f) => [`FAMILIA:${f.id}`, f.orden] as const),
        ]);
        const aMover = valido.valor.filter(
          (r, posicion) => ordenGuardado.get(`${r.tipo}:${r.id}`) !== posicion,
        );
        if (seccion.modo === "A_MANO" && aMover.length === 0)
          return ok({ versionDelOrden: seccion.version, yaEstaba: true, movidos: 0 });
        if (seccion.version !== entrada.versionDelOrdenEsperada)
          return err("VERSION_DESACTUALIZADA");

        for (const [posicion, r] of valido.valor.entries()) {
          if (ordenGuardado.get(`${r.tipo}:${r.id}`) === posicion) continue;
          await tx.familias.ponerOrden(empresaId, r, posicion, {
            por: contexto.personaId,
            en: contexto.ahora,
          });
        }
        const fijada = await tx.familias.fijarOrdenDeSeccion(
          empresaId,
          seccion.id,
          seccion.version,
          "A_MANO",
        );
        if (!fijada) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ORDEN_DE_CARTA_CAMBIADO",
          entidad: "seccion_de_carta",
          entidadId: seccion.id,
          antes: { modo: seccion.modo },
          despues: {
            modo: "A_MANO",
            orden: valido.valor.map((r) => `${r.tipo}:${r.id}`).join(","),
          },
        });
        return ok({
          versionDelOrden: seccion.version + 1,
          yaEstaba: false,
          movidos: aMover.length,
        });
      },
    );
    return traducir(resultado);
  };
}

/**
 * La estrella (★) de un renglón (A8, CU-F8): por EMPRESA y SIN tope (DDD 68). Acción `productos.editar`, alcance TODAS. Pide el ESTADO (no alterna): si ya está así, `yaEstaba`
 * sin escribir ni auditar. El renglón (la familia o el producto) tiene que ser de la empresa; un producto tiene que venderse. Se toma la fila `FOR UPDATE` para que
 * dos pedidos a la vez se pongan en fila.
 */
export function armarDestacarRenglon(dependencias: DependenciasDeCatalogo) {
  return async function destacarRenglon(
    contexto: ContextoOperativo,
    entrada: EntradaDeDestacarRenglon,
  ): Promise<R<SalidaDeDestacarRenglon>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeDestacarRenglon>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.id) || (entrada.tipo !== "PRODUCTO" && entrada.tipo !== "FAMILIA"))
          return err("IDENTIFICADOR_INVALIDO");
        let actual: boolean;
        if (entrada.tipo === "FAMILIA") {
          const familia = await tx.familias.bloquear(empresaId, entrada.id);
          if (familia === null) return err("FAMILIA_NO_ENCONTRADA");
          const estrella = await tx.familias.estrellaDeLaFamilia(empresaId, familia.id);
          actual = estrella === true;
        } else {
          const producto = await tx.productos.bloquear(empresaId, entrada.id);
          if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
          if (!vendeLaClase(producto.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");
          actual = await tx.familias.estrellaDelProducto(empresaId, producto.id);
        }
        if (actual === entrada.destacado) return ok({ yaEstaba: true });
        await tx.familias.ponerEstrella(empresaId, entrada, entrada.destacado, {
          por: contexto.personaId,
          en: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "RENGLON_DESTACADO",
          entidad: entrada.tipo === "FAMILIA" ? "familia_de_producto" : "producto",
          entidadId: entrada.id,
          antes: { destacado: actual },
          despues: { destacado: entrada.destacado },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
