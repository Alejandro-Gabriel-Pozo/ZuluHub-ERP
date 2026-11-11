import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { porcentajeDesdeTexto, type Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  esUnidadConocida,
  validarComposicion,
  type ComponenteAValidar,
  type ErrorDeComposicion,
  type PerillasDeComposicion,
} from "../dominio/composicion";
import { esUuid } from "../persistencia/filas";
import type { ComposicionGuardada } from "../persistencia/modelo";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeStock, TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { leerCantidad } from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

/**
 * Tope de componentes de una receta: el de la base (`componente_numero_ck`, `numero` es un `smallint`). Una receta real tiene unos pocos;
 * el tope solo evita mandar a la base una lista que no entra.
 */
export const MAXIMO_DE_COMPONENTES = 32_767;

/** Un componente tal como llega de la pantalla: el producto (con artículo de stock), la cantidad en texto decimal y la unidad en que se escribió. */
export type ComponenteDeEntrada = Readonly<{
  productoId: string;
  cantidad: string;
  unidadId: string;
  /**
   * Pérdida en puntos porcentuales. Solo existe para que la perilla `composiciones_con_perdida` la rechace con su error (E6 la abre): con la
   * perilla apagada es `FUNCION_NO_INCLUIDA`, y con ella encendida sigue siéndolo hasta que la explosión la aplique (SUPUESTO (DEC-0074), nace cerrado).
   */
  perdida?: string | undefined;
}>;

export type EntradaDeGuardarComposicion = Readonly<{
  productoId: string;
  /** El número de la última versión que vio la persona (0 si el producto nunca tuvo receta). */
  versionEsperada: number;
  /** Cuántas unidades vendidas rinde la receta (texto decimal, mayor que cero). */
  rinde: string;
  /** El conjunto FINAL de componentes (no una diferencia). */
  componentes: readonly ComponenteDeEntrada[];
}>;
export type SalidaDeGuardarComposicion = Readonly<{ version: number; yaExistia: boolean }>;

export type EntradaDeRetirarComposicion = Readonly<{
  productoId: string;
  versionEsperada: number;
}>;
export type SalidaDeRetirarComposicion = Readonly<{ version: number; yaEstaba: boolean }>;

/** Lo que dice un puntaje de pérdida permitido: de 0 a 99,9999 (la base exige menos de 100), con hasta 4 decimales. */
const FORMA_DE_LA_PERDIDA = /^[0-9]{1,2}(\.[0-9]{1,4})?$/;

type ComponenteLeido = Readonly<{
  productoId: string;
  cantidad: Cantidad;
  unidadId: string;
  perdida: Porcentaje | null;
}>;

function leerVersionEsperada(valor: unknown): R<number> {
  return typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    valor >= 0 &&
    valor <= 2_147_483_647
    ? ok(valor)
    : err("IDENTIFICADOR_INVALIDO");
}

/** El rinde: texto decimal exacto mayor que cero (`RINDE_INVALIDO` si no). */
function leerRinde(texto: unknown): R<Cantidad> {
  if (typeof texto !== "string") return err("RINDE_INVALIDO");
  const leido = cantidadConSignoDesdeTexto(texto);
  if (!leido.ok || leido.valor.unidades < 1n) return err("RINDE_INVALIDO");
  return ok(cantidadDesdeTexto(texto));
}

/**
 * Los componentes que manda la pantalla, ya con su forma comprobada (lista de permitidos): de 0 a `MAXIMO_DE_COMPONENTES`, cada uno con
 * producto (UUID), cantidad mayor que cero, unidad conocida y, si trae pérdida, un porcentaje bien escrito. Una lista vacía pasa: la
 * rechaza el dominio como `COMPOSICION_VACIA`.
 */
function leerComponentes(valor: unknown): R<readonly ComponenteLeido[]> {
  if (!Array.isArray(valor)) return err("COMPOSICION_VACIA");
  if (valor.length > MAXIMO_DE_COMPONENTES) return err("COMPOSICION_VACIA");
  const leidos: ComponenteLeido[] = [];
  for (const crudo of valor as unknown[]) {
    const componente = (typeof crudo === "object" && crudo !== null ? crudo : {}) as Record<
      string,
      unknown
    >;
    const productoId = componente["productoId"];
    if (typeof productoId !== "string" || !esUuid(productoId)) {
      return err("COMPONENTE_NO_CONTROLADO");
    }
    const cantidad = leerCantidad(componente["cantidad"]);
    if (!cantidad.ok) return cantidad;
    const unidadId = componente["unidadId"];
    if (typeof unidadId !== "string" || !esUnidadConocida(unidadId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const textoDePerdida = componente["perdida"];
    let perdida: Porcentaje | null = null;
    if (textoDePerdida !== undefined && textoDePerdida !== null) {
      if (typeof textoDePerdida !== "string" || !FORMA_DE_LA_PERDIDA.test(textoDePerdida)) {
        return err("CANTIDAD_INVALIDA");
      }
      perdida = porcentajeDesdeTexto(textoDePerdida);
    }
    leidos.push({
      productoId: productoId.toLowerCase(),
      cantidad: cantidad.valor,
      unidadId,
      perdida,
    });
  }
  return ok(leidos);
}

/** El error de la validación del dominio como error del módulo (los códigos que comparten el nombre pasan tal cual). */
function errorDeComposicion(error: ErrorDeComposicion): ErrorDeStock {
  if (error.codigo === "FUNCION_NO_INCLUIDA") {
    return { error: "FUNCION_NO_INCLUIDA", perilla: error.perilla };
  }
  if (error.codigo === "UNIDAD_INVALIDA") return "IDENTIFICADOR_INVALIDO";
  if (error.codigo === "FUERA_DE_RANGO") return "CANTIDAD_INVALIDA";
  return error.codigo;
}

/** Las perillas de la receta, leídas del plan solo si alguien pidió pérdida (si no, nada las consulta). */
async function perillasDeLaReceta(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  pedida: boolean,
): Promise<PerillasDeComposicion> {
  if (!pedida) return { composiciones_con_perdida: false, subcomposiciones: false };
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const alcance = { empresaId: contexto.empresaId };
  return {
    composiciones_con_perdida: exigirPerilla(derechos, "composiciones_con_perdida", alcance).ok,
    subcomposiciones: exigirPerilla(derechos, "subcomposiciones", alcance).ok,
  };
}

/** El contenido de una receta en forma canónica (rinde y componentes por artículo, sin depender del orden): sirve para saber si no cambió nada. */
function contenidoCanonico(
  rinde: string,
  componentes: readonly Readonly<{
    articuloId: string;
    cantidad: string;
    unidadId: string;
  }>[],
): string {
  const ordenados = componentes
    .map((c) => `${c.articuloId}|${cantidadATexto(cantidadDesdeTexto(c.cantidad))}|${c.unidadId}`)
    .sort();
  return JSON.stringify([cantidadATexto(cantidadDesdeTexto(rinde)), ordenados]);
}

const contenidoDeLaVersion = (version: ComposicionGuardada): string =>
  contenidoCanonico(version.rinde, version.componentes);

/** Los datos de una versión para la auditoría (sin el contenido completo de cada componente repetido: artículo, cantidad y unidad). */
const resumenDeLaVersion = (version: ComposicionGuardada) => ({
  version: version.numero,
  rinde: version.rinde,
  componentes: version.componentes.map((c) => ({
    articuloId: c.articuloId,
    cantidad: c.cantidad,
    unidadId: c.unidadId,
  })),
});

/**
 * Guardar la receta de un producto vendible (E5 §3.2): el CONJUNTO FINAL de componentes con su `rinde`, no una diferencia, como una versión
 * nueva (solo inserción; vale la de mayor número). Guard `composiciones.editar` con alcance TODAS (la receta es de la empresa, no de una
 * sucursal: SUPUESTO (DEC-0074), como los artículos). Solo un producto `VENDIBLE` tiene receta (`PRODUCTO_NO_ES_VENDIBLE`, S-6) y cada componente es un
 * producto con artículo de stock ACTIVO (`COMPONENTE_NO_CONTROLADO`); el dominio comprueba el resto (`validarComposicion`: no vacía, `rinde`
 * mayor que cero, sin repetidos, cantidad y unidad de la dimensión del artículo y con conversión exacta). Pérdida y compuesto existen en la
 * base para E6 y acá `FUNCION_NO_INCLUIDA` los rechaza (la perilla apagada, y encendida también hasta que la explosión la aplique).
 * Repetición (`SIN_CAMBIOS`): el mismo contenido que la versión vigente devuelve esa versión con `yaExistia` sin escribir ni auditar, aunque la
 * versión esperada sea vieja (un reintento tras un éxito no falla). Si no, compara `versionEsperada` (`COMPOSICION_DESACTUALIZADA`): de dos
 * guardados a la vez con la misma versión, gana uno (la base impone `(empresa, producto, numero)` único). La auditoría de configuración queda
 * en la misma transacción.
 */
export function armarGuardarComposicion(dependencias: DependenciasDeStock) {
  return async function guardarComposicion(
    contexto: ContextoOperativo,
    entrada: EntradaDeGuardarComposicion,
  ): Promise<R<SalidaDeGuardarComposicion>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeGuardarComposicion>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "composiciones.editar",
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const versionEsperada = leerVersionEsperada(entrada.versionEsperada);
        if (!versionEsperada.ok) return versionEsperada;
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) {
          return err("PRODUCTO_NO_ENCONTRADO");
        }
        const leidos = leerComponentes(entrada.componentes);
        if (!leidos.ok) return leidos;
        const rinde = leerRinde(entrada.rinde);

        // `FOR SHARE`: desactivar el producto a la vez espera a este comando (o este ve el producto ya desactivado).
        const producto = await tx.productosParaStock.bloquearCompartido(
          empresaId,
          entrada.productoId,
        );
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (producto.claseDeUso !== "VENDIBLE") return err("PRODUCTO_NO_ES_VENDIBLE");
        const vigente = await tx.composicionesDeStock.ultimaVersion(empresaId, producto.id);

        // Cada componente es un producto con artículo (activo o no por ahora: una repetición no depende de cómo esté el catálogo hoy).
        const articulos = await tx.articulosDeStock.porProductos(
          empresaId,
          leidos.valor.map((c) => c.productoId),
        );
        const articuloDe = new Map(articulos.map((a) => [a.productoId, a]));
        const aValidar: ComponenteAValidar[] = [];
        for (const c of leidos.valor) {
          const articulo = articuloDe.get(c.productoId);
          if (articulo === undefined) return err("COMPONENTE_NO_CONTROLADO");
          aValidar.push({
            articuloId: articulo.id,
            cantidad: c.cantidad,
            unidadId: c.unidadId,
            unidadDeStockId: articulo.unidadDeStockId,
            perdida: c.perdida,
            compuestoId: null,
          });
        }
        const perillas = await perillasDeLaReceta(
          tx,
          contexto,
          leidos.valor.some((c) => c.perdida !== null && c.perdida.unidades !== 0n),
        );
        // Con la lista vacía el dominio dice `COMPOSICION_VACIA` antes de mirar el rinde: así el orden de los errores es el de la spec.
        const validada = validarComposicion(
          rinde.ok ? rinde.valor : cantidadDesdeTexto("0"),
          aValidar,
          perillas,
        );
        if (!validada.ok) return err(errorDeComposicion(validada.error));
        // Con la perilla encendida la pérdida pasa el dominio, pero la explosión (E6) todavía no la aplica: guardarla sería prometer algo que no se hace.
        if (leidos.valor.some((c) => c.perdida !== null && c.perdida.unidades !== 0n)) {
          return err({ error: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" });
        }

        const pedido = contenidoCanonico(
          cantidadATexto(validada.valor.rinde),
          validada.valor.componentes.map((c) => ({
            articuloId: c.articuloId,
            cantidad: cantidadATexto(c.cantidad),
            unidadId: c.unidadId,
          })),
        );
        if (vigente !== null && contenidoDeLaVersion(vigente) === pedido) {
          return ok({ version: vigente.numero, yaExistia: true });
        }
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        if ((vigente?.numero ?? 0) !== versionEsperada.valor) {
          return err("COMPOSICION_DESACTUALIZADA");
        }
        if (articulos.some((a) => !a.activo)) return err("COMPONENTE_NO_CONTROLADO");

        const guardada = await tx.composicionesDeStock.insertarVersion(empresaId, {
          productoId: producto.id,
          numero: (vigente?.numero ?? 0) + 1,
          rinde: cantidadATexto(validada.valor.rinde),
          creadaPor: persona,
          creadaEn: contexto.ahora,
          componentes: validada.valor.componentes.map((c) => {
            const articulo = articulos.find((a) => a.id === c.articuloId);
            if (articulo === undefined)
              throw new Error("el artículo de un componente validado no está");
            return {
              articuloId: c.articuloId,
              cantidad: cantidadATexto(c.cantidad),
              unidadId: c.unidadId,
              dimension: articulo.dimension,
            };
          }),
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "COMPOSICION_GUARDADA",
          entidad: "composicion",
          entidadId: guardada.id,
          antes:
            vigente === null ? null : { productoId: producto.id, ...resumenDeLaVersion(vigente) },
          despues: { productoId: producto.id, ...resumenDeLaVersion(guardada) },
        });
        return ok({ version: guardada.numero, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Retirar la receta de un producto (E5 §3.2): inserta una versión VACÍA y el producto vuelve a «falta receta» (la venta sigue pasando, D140).
 * Guard `composiciones.editar` con alcance TODAS. Sin ninguna versión es `SIN_COMPOSICION`. Repetición (`YA_ESTABA`): con la última versión ya
 * vacía devuelve esa versión con `yaEstaba` sin escribir ni auditar, aunque la versión esperada sea vieja. Si no, compara `versionEsperada`
 * (`COMPOSICION_DESACTUALIZADA`).
 */
export function armarRetirarComposicion(dependencias: DependenciasDeStock) {
  return async function retirarComposicion(
    contexto: ContextoOperativo,
    entrada: EntradaDeRetirarComposicion,
  ): Promise<R<SalidaDeRetirarComposicion>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeRetirarComposicion>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "composiciones.editar",
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const versionEsperada = leerVersionEsperada(entrada.versionEsperada);
        if (!versionEsperada.ok) return versionEsperada;
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) {
          return err("PRODUCTO_NO_ENCONTRADO");
        }
        const producto = await tx.productosParaStock.bloquearCompartido(
          empresaId,
          entrada.productoId,
        );
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        const vigente = await tx.composicionesDeStock.ultimaVersion(empresaId, producto.id);
        if (vigente === null) return err("SIN_COMPOSICION");
        if (vigente.componentes.length === 0)
          return ok({ version: vigente.numero, yaEstaba: true });
        if (vigente.numero !== versionEsperada.valor) return err("COMPOSICION_DESACTUALIZADA");

        const retirada = await tx.composicionesDeStock.insertarVersion(empresaId, {
          productoId: producto.id,
          numero: vigente.numero + 1,
          rinde: vigente.rinde,
          creadaPor: persona,
          creadaEn: contexto.ahora,
          componentes: [],
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "COMPOSICION_RETIRADA",
          entidad: "composicion",
          entidadId: retirada.id,
          antes: { productoId: producto.id, ...resumenDeLaVersion(vigente) },
          despues: { productoId: producto.id, ...resumenDeLaVersion(retirada) },
        });
        return ok({ version: retirada.numero, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
