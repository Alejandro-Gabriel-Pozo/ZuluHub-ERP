import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import {
  precioUnitarioATexto,
  type PrecioUnitario,
} from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { vendeLaClase } from "../dominio/clases";
import {
  esUnidad,
  formaDeVentaDelPiloto,
  precioEnOtraUnidad,
  validarFormaDeVenta,
} from "../dominio/forma-de-venta";
import type { FilaDePrecio, Grupo, Opcion } from "../dominio/modelo";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCambiarFormaDeVenta = Readonly<{
  productoId: string;
  versionEsperada: number;
  unidadDeVentaId: string;
  /** Texto decimal exacto: 1, 0.5, 0.25… */
  pasoMinimo: string;
}>;

export type SalidaDeCambiarFormaDeVenta = Readonly<{
  version: number;
  /**
   * `SOLO_PASO`: los precios siguen y se copian con el paso nuevo. `CONVERTIDO`: otra unidad y todo convirtió exacto en 6 decimales.
   * `QUEDO_EN_PRECIO_ABIERTO`: algo no convertía exacto y el producto quedó en precio abierto hasta cargar los precios nuevos
   * (decisión 169: no hay error). `SIN_CAMBIOS`: la forma pedida ya era la del producto.
   */
  resultado: "SOLO_PASO" | "CONVERTIDO" | "QUEDO_EN_PRECIO_ABIERTO" | "SIN_CAMBIOS";
  preciosConvertidos: number;
  preciosEnAbierto: ReadonlyArray<{
    opcionId: string | null;
    sucursalId: string | null;
    precioAnterior: string;
  }>;
  recargosEnCero: ReadonlyArray<{
    opcionId: string;
    sucursalId: string | null;
    recargoAnterior: string;
  }>;
  yaEstaba: boolean;
}>;

const SIN_FILAS: Pick<
  SalidaDeCambiarFormaDeVenta,
  "preciosConvertidos" | "preciosEnAbierto" | "recargosEnCero"
> = {
  preciosConvertidos: 0,
  preciosEnAbierto: [],
  recargosEnCero: [],
};

type Viva = Readonly<{ fila: FilaDePrecio; esRecargo: boolean }>;

/**
 * Las filas de precio vigentes que hay que volver a cargar con la forma nueva: las que hoy pueden escribirse (el producto no tiene variante
 * activa si la fila es suya; la opción es de un grupo activo; un recargo propio de sucursal solo en un adicional, y con valor solo si el
 * grupo se muestra). Las de sucursal con «vuelve a la empresa» (nulo) no se tocan: siguen valiendo con cualquier forma. Una fila inerte
 * (por ejemplo, el precio propio de un producto con variante) NO se reescribe: queda en su forma vieja y, si volviera a regir, `cotizar` la
 * rechaza (`PRECIO_EN_OTRA_FORMA_DE_VENTA`): falla cerrado.
 */
function filasVivas(
  filas: readonly FilaDePrecio[],
  grupos: ReadonlyArray<{ grupo: Grupo; opciones: readonly Opcion[] }>,
): Viva[] {
  const varianteActiva = grupos.some(({ grupo }) => grupo.clase === "VARIANTE" && grupo.activo);
  const vivas: Viva[] = [];
  for (const fila of filas) {
    if (fila.sucursalId !== null && fila.precio === null) continue;
    if (fila.opcionId === null) {
      if (!varianteActiva) vivas.push({ fila, esRecargo: false });
      continue;
    }
    const grupo = grupos.find(({ opciones }) =>
      opciones.some((o) => o.id === fila.opcionId),
    )?.grupo;
    if (grupo === undefined || !grupo.activo) continue;
    if (grupo.clase === "VARIANTE") vivas.push({ fila, esRecargo: false });
    else if (
      grupo.clase === "ADICIONAL" &&
      fila.sucursalId !== null &&
      (fila.precio === null || grupo.seMuestraEnCarta)
    ) {
      vivas.push({ fila, esRecargo: true });
    }
  }
  return vivas;
}

const comoPrecio = (texto: string): PrecioUnitario => {
  const leido = precioDeVentaDesdeTexto(texto);
  if (!leido.ok) throw new RangeError(`precio inválido en la base: ${texto}`);
  return leido.valor;
};

/**
 * Cambiar la forma de venta (unidad y paso) de un producto (§3.5 y §3.8; decisiones 162, 166 y 169). Guard: `productos.editar` y
 * `productos.cambiar_precio`, con alcance TODAS (reescribe precios de toda la empresa). Bloquea el producto, compara `versionEsperada`,
 * valida (producto activo y que se vende; unidad de la misma dimensión; paso decimal exacto > 0 que cabe exacto en la unidad base; forma
 * habilitada: por defecto la del piloto, `FORMA_DE_VENTA_NO_SOPORTADA`). TODO en la misma transacción, o nada:
 *  - solo cambia el paso → los precios siguen y se cargan de nuevo con el paso nuevo;
 *  - cambia la unidad y todo convierte exacto en 6 decimales (kilo → gramo) → filas nuevas `precio × factor` (y una versión nueva por cada
 *    recargo de la empresa, con lo que consumía);
 *  - cambia la unidad y ALGO no convierte exacto → el sistema NO se niega: cada precio vigente no nulo recibe una fila nueva con `precio =
 *    NULL` (precio abierto) y los recargos de la empresa pasan a una versión nueva con recargo 0 (SUPUESTO (DEC-0073) Q7: con precio abierto el
 *    recargo es informativo; el valor anterior queda en la versión vieja, en la auditoría y en el resultado).
 * Lo ya congelado no cambia: tickets y líneas conservan su `precioId`, unidad y paso; las filas viejas no se tocan. Audita una entrada con
 * la forma anterior, la nueva y la lista completa de lo creado. Repetición (`SIN_CAMBIOS`): la forma pedida ya es la del producto.
 */
export function armarCambiarFormaDeVenta(dependencias: DependenciasDeCatalogo) {
  return async function cambiarFormaDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarFormaDeVenta,
  ): Promise<R<SalidaDeCambiarFormaDeVenta>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarFormaDeVenta>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "productos.editar",
          "productos.cambiar_precio",
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const producto = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        if (!vendeLaClase(producto.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");

        const forma = validarFormaDeVenta(
          producto.unidadBaseId,
          entrada.unidadDeVentaId,
          entrada.pasoMinimo,
        );
        if (!forma.ok) return err(forma.error);
        const paso = cantidadATexto(forma.valor.pasoMinimo);
        if (
          producto.unidadDeVentaId === forma.valor.unidadDeVentaId &&
          producto.pasoMinimo === paso
        ) {
          return ok({
            version: producto.version,
            resultado: "SIN_CAMBIOS",
            ...SIN_FILAS,
            yaEstaba: true,
          });
        }
        const habilitada = dependencias.formaDeVentaHabilitada ?? formaDeVentaDelPiloto;
        if (!habilitada(producto.unidadBaseId, forma.valor))
          return err("FORMA_DE_VENTA_NO_SOPORTADA");
        if (entrada.versionEsperada !== producto.version) return err("VERSION_DESACTUALIZADA");

        const unidadVieja = producto.unidadDeVentaId;
        const unidadNueva = forma.valor.unidadDeVentaId;
        if (!esUnidad(unidadVieja))
          throw new RangeError(`unidad inválida en la base: ${unidadVieja}`);
        const grupos = await tx.opciones.gruposDelProducto(empresaId, producto.id);
        const vivas = filasVivas(
          await tx.precios.ultimasPorAlcance(empresaId, producto.id),
          grupos,
        );
        const recargos = grupos
          .filter(({ grupo }) => grupo.clase === "ADICIONAL")
          .flatMap(({ opciones }) => opciones)
          .filter((o) => comoPrecio(o.recargo).unidades !== 0n);

        // Qué pasa con los precios: todo o nada, nunca una parte en una unidad y otra parte en otra.
        const cambiaLaUnidad = unidadVieja !== unidadNueva;
        let modo: "SOLO_PASO" | "CONVERTIDO" | "QUEDO_EN_PRECIO_ABIERTO" = "SOLO_PASO";
        const convertido = new Map<string, string | null>(); // id de fila de precio → precio nuevo
        const recargoNuevo = new Map<string, string>(); // id de opción → recargo nuevo
        if (cambiaLaUnidad) {
          modo = "CONVERTIDO";
          for (const { fila } of vivas) {
            if (fila.precio === null) continue;
            const nuevo = precioEnOtraUnidad(comoPrecio(fila.precio), unidadVieja, unidadNueva);
            if (nuevo === null) modo = "QUEDO_EN_PRECIO_ABIERTO";
            else convertido.set(fila.id, precioUnitarioATexto(nuevo));
          }
          for (const o of recargos) {
            const nuevo = precioEnOtraUnidad(comoPrecio(o.recargo), unidadVieja, unidadNueva);
            if (nuevo === null) modo = "QUEDO_EN_PRECIO_ABIERTO";
            else recargoNuevo.set(o.id, precioUnitarioATexto(nuevo));
          }
        }

        // La forma del producto primero: el disparador de precios exige que las filas nuevas lleven la del producto.
        const cambiado = await tx.productos.cambiarFormaDeVenta(
          empresaId,
          producto.id,
          unidadNueva,
          paso,
        );
        if (cambiado === null) return err("PRODUCTO_NO_ENCONTRADO");

        const preciosEnAbierto: Array<{
          opcionId: string | null;
          sucursalId: string | null;
          precioAnterior: string;
        }> = [];
        const recargosEnCero: Array<{
          opcionId: string;
          sucursalId: string | null;
          recargoAnterior: string;
        }> = [];
        const filasCreadas: Array<{
          precioId: string;
          opcionId: string | null;
          sucursalId: string | null;
          precio: string | null;
        }> = [];
        let preciosConvertidos = 0;
        for (const { fila, esRecargo } of vivas) {
          let precio: string | null = null;
          if (fila.precio !== null) {
            if (modo === "QUEDO_EN_PRECIO_ABIERTO") {
              if (esRecargo && fila.opcionId !== null) {
                recargosEnCero.push({
                  opcionId: fila.opcionId,
                  sucursalId: fila.sucursalId,
                  recargoAnterior: fila.precio,
                });
              } else {
                preciosEnAbierto.push({
                  opcionId: fila.opcionId,
                  sucursalId: fila.sucursalId,
                  precioAnterior: fila.precio,
                });
              }
            } else {
              precio =
                modo === "CONVERTIDO"
                  ? (convertido.get(fila.id) ?? null)
                  : precioUnitarioATexto(comoPrecio(fila.precio));
              preciosConvertidos += 1;
            }
          }
          const nueva = await tx.precios.insertar(empresaId, {
            productoId: producto.id,
            opcionId: fila.opcionId,
            sucursalId: fila.sucursalId,
            precio,
            unidadId: unidadNueva,
            pasoMinimo: paso,
            ahora: contexto.ahora,
            cargadoPor: contexto.personaId,
          });
          if (nueva === null) {
            throw new Error("la base devolvió un precio nuevo sin fila: el id lo genera ella");
          }
          filasCreadas.push({
            precioId: nueva.id,
            opcionId: fila.opcionId,
            sucursalId: fila.sucursalId,
            precio,
          });
        }

        // Los recargos de la empresa (versión nueva de cada opción adicional con recargo): convertidos, o en cero si el producto quedó abierto.
        const versionesCreadas: Array<{ opcionId: string; versionId: string; recargo: string }> =
          [];
        if (cambiaLaUnidad) {
          for (const o of recargos) {
            const recargo =
              modo === "QUEDO_EN_PRECIO_ABIERTO"
                ? "0.000000"
                : (recargoNuevo.get(o.id) ?? "0.000000");
            if (modo === "QUEDO_EN_PRECIO_ABIERTO")
              recargosEnCero.push({ opcionId: o.id, sucursalId: null, recargoAnterior: o.recargo });
            const versionId = await tx.opciones.insertarVersion(empresaId, {
              opcionId: o.id,
              numero: o.numero + 1,
              nombre: o.nombre,
              recargo,
              factorDeTamano: o.factorDeTamano,
              cargadaPor: contexto.personaId,
              creadaEn: contexto.ahora,
            });
            const lineas =
              (await tx.opciones.consumoDeVersiones(empresaId, [o.versionId])).get(o.versionId) ??
              [];
            await tx.opciones.insertarConsumo(empresaId, versionId, lineas);
            versionesCreadas.push({ opcionId: o.id, versionId, recargo });
          }
          if (versionesCreadas.length > 0)
            await tx.productos.subirVersionDeOpciones(empresaId, producto.id);
        }

        const final = await tx.productos.obtener(empresaId, producto.id);
        if (final === null) return err("PRODUCTO_NO_ENCONTRADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PRODUCTO_FORMA_DE_VENTA_CAMBIADA",
          entidad: "producto",
          entidadId: producto.id,
          antes: { unidadDeVentaId: unidadVieja, pasoMinimo: producto.pasoMinimo },
          despues: {
            unidadDeVentaId: unidadNueva,
            pasoMinimo: paso,
            resultado: modo,
            preciosConvertidos,
            preciosEnAbierto,
            recargosEnCero,
            filasDePrecioCreadas: filasCreadas,
            versionesDeOpcionCreadas: versionesCreadas,
          },
        });
        return ok({
          version: final.version,
          resultado: modo,
          preciosConvertidos,
          preciosEnAbierto,
          recargosEnCero,
          yaEstaba: false,
        });
      },
    );
    return traducir(resultado);
  };
}
