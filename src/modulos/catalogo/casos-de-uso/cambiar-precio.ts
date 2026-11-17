import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  sucursalId as aSucursalId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { vendeLaClase } from "../dominio/clases";
import {
  esUuid,
  precioDeVentaId,
  type OpcionId,
  type PrecioDeVentaId,
} from "../dominio/identificadores";
import type { FilaDePrecio } from "../dominio/modelo";
import { autorizar, exigirAlcanceTotal, exigirSucursalAbierta, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCambiarPrecio = Readonly<{
  /** El `id` de la fila nueva lo manda la aplicación: es la clave de idempotencia del cambio. */
  precioId: string;
  productoId: string;
  /** `null`: el precio del producto. Una opción de la variante: el precio de ese tamaño. Una opción adicional (con sucursal): su recargo propio. */
  opcionId: string | null;
  /** `null`: el precio de la empresa (exige alcance TODAS). */
  sucursalId: string | null;
  /** La fila que hoy es vigente en el MISMO alcance, según quien pide (`null` si no había ninguna). */
  precioIdEsperado: string | null;
  /** Texto decimal exacto, ARS con IVA incluido; `null` solo con sucursal (vuelve al de la empresa). */
  precio: string | null;
}>;

export type SalidaDeCambiarPrecio = Readonly<{
  precioId: PrecioDeVentaId;
  /** Desde cuándo rige. Ausente si fue una repetición. */
  vigenteDesde: Date | null;
  yaExistia: boolean;
}>;

const mismoContenido = (
  guardada: FilaDePrecio,
  entrada: Readonly<{
    producto: string;
    opcion: string | null;
    sucursal: string | null;
    precio: string | null;
  }>,
) =>
  guardada.productoId === entrada.producto &&
  guardada.opcionId === entrada.opcion &&
  guardada.sucursalId === entrada.sucursal &&
  guardada.precio === entrada.precio;

/**
 * Cambiar un precio o un recargo de sucursal (§3.5). Guard `productos.cambiar_precio`; el precio de la empresa exige alcance TODAS y el
 * de una sucursal que esté en el alcance de quien pide, exista en la empresa y esté abierta. Orden fijo dentro de la transacción, después de
 * bloquear el producto (`FOR UPDATE`):
 *  1. el producto existe, está activo y se vende; la opción es de ese producto, activa y de su variante activa o de un grupo ADICIONAL activo
 *     (este último, solo con sucursal); sin opción, el producto no tiene variante activa;
 *  2. REPETICIÓN: si ya existe una fila con ese `precioId`, mismo contenido → `yaExistia: true` sin escribir (se evalúa ANTES de mirar
 *     `precioIdEsperado`, para que el segundo clic o el reintento no den un falso conflicto); otro contenido → `ID_REUTILIZADO`;
 *  3. control de versión: `precioIdEsperado` es la fila hoy vigente EN EL MISMO ALCANCE (`PRECIO_DESACTUALIZADO` con lo vigente);
 *  4. inserta (la unidad y el paso son los del producto; rige desde el mayor entre `ahora` y 1 µs después de la última del alcance) y audita.
 * Dos cambios simultáneos sobre lo mismo se serializan por el bloqueo: gana uno y el otro ve `PRECIO_DESACTUALIZADO`.
 */
export function armarCambiarPrecio(dependencias: DependenciasDeCatalogo) {
  return async function cambiarPrecio(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarPrecio,
  ): Promise<R<SalidaDeCambiarPrecio>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarPrecio>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "productos.cambiar_precio",
        ]);
        if (!permiso.ok) return permiso;
        if (
          !esUuid(entrada.precioId) ||
          (entrada.opcionId !== null && !esUuid(entrada.opcionId)) ||
          (entrada.sucursalId !== null && !esUuid(entrada.sucursalId))
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        let sucursal: SucursalId | null = null;
        if (entrada.sucursalId === null) {
          const alcance = await exigirAlcanceTotal(tx, contexto);
          if (!alcance.ok) return alcance;
        } else {
          sucursal = aSucursalId(entrada.sucursalId);
          const abierta = await exigirSucursalAbierta(tx, contexto, sucursal);
          if (!abierta.ok) return abierta;
        }
        // Un precio vacío solo con sucursal (vuelve al de la empresa); sin sucursal, el precio abierto lo escribe `cambiarFormaDeVenta`.
        let precio: string | null = null;
        if (entrada.precio === null) {
          if (sucursal === null) return err("PRECIO_INVALIDO");
        } else {
          const leido = precioDeVentaDesdeTexto(entrada.precio);
          if (!leido.ok) return err("PRECIO_INVALIDO");
          precio = precioUnitarioATexto(leido.valor);
        }

        const producto = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        if (!vendeLaClase(producto.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");
        const grupos = await tx.opciones.gruposDelProducto(empresaId, producto.id);
        const varianteActiva = grupos.some(
          ({ grupo }) => grupo.clase === "VARIANTE" && grupo.activo,
        );
        let opcion: OpcionId | null = null;
        if (entrada.opcionId === null) {
          if (varianteActiva) return err("PRECIO_DE_PRODUCTO_CON_VARIANTE");
        } else {
          const hallada = grupos
            .flatMap((g) => g.opciones.map((o) => ({ g: g.grupo, o })))
            .find(({ o }) => o.id === entrada.opcionId);
          if (hallada === undefined || !hallada.o.activa || !hallada.g.activo)
            return err("OPCION_INVALIDA");
          if (hallada.g.clase === "INCLUIDA") return err("INCLUIDA_CON_RECARGO");
          if (hallada.g.clase === "ADICIONAL") {
            if (sucursal === null) return err("RECARGO_DE_EMPRESA_SE_EDITA_EN_OPCIONES");
            if (precio !== null && !hallada.g.seMuestraEnCarta)
              return err("ELECCION_OCULTA_CON_PRECIO");
          }
          opcion = hallada.o.id;
        }

        const existente = await tx.precios.obtener(empresaId, entrada.precioId);
        if (existente !== null) {
          const igual = mismoContenido(existente, {
            producto: producto.id,
            opcion: opcion,
            sucursal,
            precio,
          });
          return igual
            ? ok({ precioId: existente.id, vigenteDesde: null, yaExistia: true })
            : err("ID_REUTILIZADO");
        }

        const ultima = await tx.precios.ultimaDelAlcance(empresaId, producto.id, opcion, sucursal);
        if ((ultima === null ? null : ultima.id) !== entrada.precioIdEsperado) {
          return err({
            error: "PRECIO_DESACTUALIZADO",
            vigente: ultima === null ? null : { precioId: ultima.id, precio: ultima.precio },
          });
        }
        const nueva = await tx.precios.insertar(empresaId, {
          id: precioDeVentaId(entrada.precioId),
          productoId: producto.id,
          opcionId: opcion,
          sucursalId: sucursal,
          precio,
          unidadId: producto.unidadDeVentaId,
          pasoMinimo: producto.pasoMinimo,
          ahora: contexto.ahora,
          cargadoPor: contexto.personaId,
        });
        if (nueva === null) {
          // Alguien escribió ese `precioId` entre la lectura de arriba y ahora: se vuelve a mirar (repetición o id ajeno).
          const repetida = await tx.precios.obtener(empresaId, entrada.precioId);
          const igual =
            repetida !== null &&
            mismoContenido(repetida, { producto: producto.id, opcion, sucursal, precio });
          return igual
            ? ok({ precioId: repetida.id, vigenteDesde: null, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PRECIO_CAMBIADO",
          entidad: "precio_de_venta",
          entidadId: nueva.id,
          antes: ultima === null ? null : { precioId: ultima.id, precio: ultima.precio },
          despues: {
            productoId: producto.id,
            opcionId: opcion,
            sucursalId: sucursal,
            precio,
            unidadId: producto.unidadDeVentaId,
            pasoMinimo: producto.pasoMinimo,
          },
        });
        return ok({ precioId: nueva.id, vigenteDesde: nueva.vigenteDesde, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}
