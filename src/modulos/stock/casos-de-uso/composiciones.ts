import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { validarComposicion, type ComponenteAValidar } from "../dominio/composicion";
import { esUuid } from "../persistencia/filas";
import { comprobarArbolDeRecetas } from "./arbol-de-recetas";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import {
  contenidoCanonico,
  contenidoDeLaVersion,
  errorDeComposicion,
  leerComponentes,
  leerPasos,
  leerRinde,
  leerVersionEsperada,
  perillasDeLaReceta,
  resumenDeLaVersion,
} from "./composiciones-comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

type R<S> = Resultado<S, ErrorDeStock>;

/**
 * Un componente tal como llega de la pantalla: el producto (con artículo de stock, o un `ELABORADO`: subcomposición, D96), la cantidad BRUTA
 * en texto decimal y la unidad en que se escribió.
 */
export type ComponenteDeEntrada = Readonly<{
  productoId: string;
  cantidad: string;
  unidadId: string;
  /**
   * Merma en puntos porcentuales (de 0 a menos de 100, hasta 4 decimales): la `cantidad` es el BRUTO y el neto = bruto × (100 − merma) ÷ 100
   * (`merma.ts`, 13/11/2026); la merma no cambia lo que se descuenta ni el costo. Con ella hace falta la perilla `composiciones_con_perdida`; apagada es `FUNCION_NO_INCLUIDA`.
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
