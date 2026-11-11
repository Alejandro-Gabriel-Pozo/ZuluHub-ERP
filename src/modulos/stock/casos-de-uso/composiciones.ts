import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import {
  porcentajeATexto,
  porcentajeDesdeTexto,
  type Porcentaje,
} from "../../../primitivas/cantidad/porcentaje";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { pasosDeRecetaDesdeTexto } from "../../../primitivas/texto/pasos-de-receta";
import {
  esUnidadConocida,
  validarComposicion,
  type ComponenteAValidar,
  type ErrorDeComposicion,
  type PerillasDeComposicion,
} from "../dominio/composicion";
import { esUuid } from "../persistencia/filas";
import type { ComposicionGuardada } from "../persistencia/modelo";
import { comprobarArbolDeRecetas } from "./arbol-de-recetas";
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

/**
 * Un componente tal como llega de la pantalla: el producto (con artículo de stock, o un `ELABORADO`: subcomposición, D96), la cantidad NETA
 * en texto decimal y la unidad en que se escribió.
 */
export type ComponenteDeEntrada = Readonly<{
  productoId: string;
  cantidad: string;
  unidadId: string;
  /**
   * Merma en puntos porcentuales (de 0 a menos de 100, hasta 4 decimales): se SUMA al neto (`merma.ts`, DEC-0100). Con ella hace falta la
   * perilla `composiciones_con_perdida`; apagada es `FUNCION_NO_INCLUIDA`.
   */
  perdida?: string | undefined;
}>;

export type EntradaDeGuardarComposicion = Readonly<{
  productoId: string;
  /** El número de la última versión que vio la persona (0 si el producto nunca tuvo receta). */
  versionEsperada: number;
  /** Cuántas unidades vendidas rinde la receta (texto decimal, mayor que cero). */
  rinde: string;
  /** Los pasos de la ficha de cocina: una línea de texto; ausente o vacío = sin pasos. */
  pasos?: string | null | undefined;
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

/** Los pasos: ausente o vacío es «sin pasos»; si hay texto, una línea de la lista de permitidos (`pasos-de-receta`). */
function leerPasos(valor: unknown): R<string | null> {
  if (valor === undefined || valor === null || valor === "") return ok(null);
  if (typeof valor !== "string") return err("IDENTIFICADOR_INVALIDO");
  const valido = pasosDeRecetaDesdeTexto(valor);
  return valido.ok ? ok(valido.valor) : err("IDENTIFICADOR_INVALIDO");
}

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
        return err("PERDIDA_INVALIDA");
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

/** Las perillas de la receta, leídas del plan solo si alguien pidió pérdida o un elaborado (si no, nada las consulta). */
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

/** El componente de una receta como lo comparan dos versiones: a quién (artículo o elaborado), cuánto neto, en qué unidad y con cuánta merma. */
type ComponenteCanonico = Readonly<{
  articuloId: string | null;
  compuestoId: string | null;
  cantidad: string;
  unidadId: string;
  /** Texto decimal de la merma; `null` o cero = sin merma. */
  perdida: string | null;
}>;

/**
 * El contenido de una receta en forma canónica (rinde, componentes sin depender del orden, merma y pasos): sirve para saber si no cambió
 * nada (repetir el guardado devuelve la versión vigente, I8). Una merma en cero y una ausente son lo mismo; unos pasos vacíos y ausentes también.
 */
function contenidoCanonico(
  rinde: string,
  pasos: string | null,
  componentes: readonly ComponenteCanonico[],
): string {
  const ordenados = componentes
    .map((c) => {
      const perdida = porcentajeATexto(porcentajeDesdeTexto(c.perdida ?? "0"));
      const quien =
        c.articuloId === null ? `elaborado:${c.compuestoId}` : `articulo:${c.articuloId}`;
      return `${quien}|${cantidadATexto(cantidadDesdeTexto(c.cantidad))}|${c.unidadId}|${perdida}`;
    })
    .sort();
  return JSON.stringify([cantidadATexto(cantidadDesdeTexto(rinde)), pasos, ordenados]);
}

const contenidoDeLaVersion = (version: ComposicionGuardada): string =>
  contenidoCanonico(version.rinde, version.pasos, version.componentes);

/** Los datos de una versión para la auditoría: a quién lleva, cuánto, en qué unidad y con qué merma, y los pasos. */
const resumenDeLaVersion = (version: ComposicionGuardada) => ({
  version: version.numero,
  rinde: version.rinde,
  pasos: version.pasos,
  componentes: version.componentes.map((c) => ({
    articuloId: c.articuloId,
    compuestoId: c.compuestoId,
    cantidad: c.cantidad,
    unidadId: c.unidadId,
    perdida: c.perdida,
  })),
});

/**
 * Guardar la receta de un producto vendible o elaborado (E5 §3.2, E6 §3.2): el CONJUNTO FINAL de componentes con su `rinde` y sus pasos, no una
 * diferencia, como una versión nueva (solo inserción; vale la de mayor número). Guard `composiciones.editar` con alcance TODAS (la receta es
 * de la empresa, no de una sucursal: SUPUESTO (DEC-0074), como los artículos). Solo un producto `VENDIBLE` o `ELABORADO` lleva receta
 * (`PRODUCTO_NO_LLEVA_RECETA`). Cada componente es un producto: un `ELABORADO` entra como elaborado (subcomposición: perilla `subcomposiciones`;
 * con stock propio la explosión descuenta su artículo y sin él baja a sus ingredientes) y cualquier otro como artículo de stock ACTIVO
 * (`COMPONENTE_NO_CONTROLADO`). El dominio comprueba el resto (`validarComposicion`: no vacía, `rinde` mayor que cero, sin repetidos, cantidad y
 * unidad de la dimensión del componente con conversión exacta, merma de 0 a menos de 100 con la perilla `composiciones_con_perdida`) y
 * `comprobarArbolDeRecetas` los ciclos y los cinco niveles hacia abajo Y hacia arriba. Repetición (`SIN_CAMBIOS`): el mismo contenido que la
 * versión vigente devuelve esa versión con `yaExistia` sin escribir ni auditar, aunque la versión esperada sea vieja (un reintento tras un
 * éxito no falla). Si no, compara `versionEsperada` (`COMPOSICION_DESACTUALIZADA`): de dos guardados a la vez con la misma versión, gana
 * uno (la base impone `(empresa, producto, numero)` único); de dos guardados cruzados (A lleva B, B lleva A) la transacción serializable y el
 * disparador `composicion_sin_ciclos` dejan pasar a lo sumo uno. La auditoría de configuración queda en la misma transacción.
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
        const pasos = leerPasos(entrada.pasos);
        if (!pasos.ok) return pasos;

        // `FOR SHARE`: desactivar el producto a la vez espera a este comando (o este ve el producto ya desactivado).
        const producto = await tx.productosParaStock.bloquearCompartido(
          empresaId,
          entrada.productoId,
        );
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (producto.claseDeUso !== "VENDIBLE" && producto.claseDeUso !== "ELABORADO") {
          return err("PRODUCTO_NO_LLEVA_RECETA");
        }
        const vigente = await tx.composicionesDeStock.ultimaVersion(empresaId, producto.id);

        // Cada componente es un producto: un elaborado entra como elaborado; el resto, por su artículo (activo o no por ahora: una repetición
        // no depende de cómo esté el catálogo hoy).
        const idsDeComponentes = leidos.valor.map((c) => c.productoId);
        const productos = await tx.productosParaStock.porIds(empresaId, idsDeComponentes);
        const productoDe = new Map(productos.map((p) => [p.id, p]));
        const articulos = await tx.articulosDeStock.porProductos(empresaId, idsDeComponentes);
        const articuloDe = new Map(articulos.map((a) => [a.productoId, a]));
        const aValidar: ComponenteAValidar[] = [];
        const componentesDeStock: Array<(typeof articulos)[number]> = [];
        const elaborados: Array<(typeof productos)[number]> = [];
        /** La dimensión de cada componente (artículo o elaborado), por su id: la base exige la unidad de esa dimensión. */
        const dimensionDe = new Map<string, string>();
        for (const c of leidos.valor) {
          const componente = productoDe.get(c.productoId);
          if (componente === undefined) return err("COMPONENTE_NO_CONTROLADO");
          if (componente.claseDeUso === "ELABORADO") {
            elaborados.push(componente);
            dimensionDe.set(componente.id, componente.dimension);
            aValidar.push({
              articuloId: null,
              compuestoId: componente.id,
              cantidad: c.cantidad,
              unidadId: c.unidadId,
              unidadDeStockId: componente.unidadBaseId,
              perdida: c.perdida,
            });
            continue;
          }
          const articulo = articuloDe.get(c.productoId);
          if (articulo === undefined) return err("COMPONENTE_NO_CONTROLADO");
          componentesDeStock.push(articulo);
          dimensionDe.set(articulo.id, articulo.dimension);
          aValidar.push({
            articuloId: articulo.id,
            compuestoId: null,
            cantidad: c.cantidad,
            unidadId: c.unidadId,
            unidadDeStockId: articulo.unidadDeStockId,
            perdida: c.perdida,
          });
        }
        const perillas = await perillasDeLaReceta(
          tx,
          contexto,
          elaborados.length > 0 ||
            leidos.valor.some((c) => c.perdida !== null && c.perdida.unidades !== 0n),
        );
        // Con la lista vacía el dominio dice `COMPOSICION_VACIA` antes de mirar el rinde: así el orden de los errores es el de la spec.
        const validada = validarComposicion(
          rinde.ok ? rinde.valor : cantidadDesdeTexto("0"),
          aValidar,
          perillas,
        );
        if (!validada.ok) return err(errorDeComposicion(validada.error));

        const componentes = validada.valor.componentes.map((c) => {
          const dimension = dimensionDe.get(c.articuloId ?? c.compuestoId ?? "");
          if (dimension === undefined) {
            throw new Error("el componente de una receta validada no tiene dimensión");
          }
          return {
            articuloId: c.articuloId,
            compuestoId: c.compuestoId,
            cantidad: cantidadATexto(c.cantidad),
            unidadId: c.unidadId,
            dimension,
            perdida: c.perdida === null ? null : porcentajeATexto(c.perdida),
          };
        });
        const pedido = contenidoCanonico(
          cantidadATexto(validada.valor.rinde),
          pasos.valor,
          componentes,
        );
        if (vigente !== null && contenidoDeLaVersion(vigente) === pedido) {
          return ok({ version: vigente.numero, yaExistia: true });
        }
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        if ((vigente?.numero ?? 0) !== versionEsperada.valor) {
          return err("COMPOSICION_DESACTUALIZADA");
        }
        if (componentesDeStock.some((a) => !a.activo)) return err("COMPONENTE_NO_CONTROLADO");
        if (elaborados.some((e) => !e.activo)) return err("PRODUCTO_INACTIVO");
        if (elaborados.length > 0) {
          const arbol = await comprobarArbolDeRecetas(
            tx,
            empresaId,
            producto.id,
            elaborados.map((e) => e.id),
          );
          if (arbol !== null) return err(arbol);
        }

        const guardada = await tx.composicionesDeStock.insertarVersion(empresaId, {
          productoId: producto.id,
          numero: (vigente?.numero ?? 0) + 1,
          rinde: cantidadATexto(validada.valor.rinde),
          pasos: pasos.valor,
          creadaPor: persona,
          creadaEn: contexto.ahora,
          componentes,
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
          pasos: null,
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
