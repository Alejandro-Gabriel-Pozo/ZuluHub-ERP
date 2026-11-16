import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { leerControles } from "../dominio/control-de-recepcion";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { leerRemito, leerRenglonesDeCompra, type Remito } from "../dominio/registrar-compra";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { calcularRenglones, leerHechoEn } from "./registrar-compra-apoyo";
import type { EntradaDeRegistrarCompra } from "./registrar-compra-tipos";
import { exigirNivelSeparado } from "./nivel-separado";
import { huellaDeLaRecepcion } from "../dominio/recepcion-separada";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

/** Lo que pide recibir sin factura en N3 o N4: como «Comprar y recibir» sin factura ni pago ni depósito (el stock entra al confirmar), más el control por línea. */
export type EntradaDeRegistrarRecepcion = Omit<
  EntradaDeRegistrarCompra,
  "factura" | "pago" | "depositoId"
> &
  Readonly<{
    /** El control de la mercadería por línea (`dominio/control-de-recepcion.ts`); una línea sin control = «no se constató». */
    controles?: unknown;
  }>;

export type SalidaDeRegistrarRecepcion = Readonly<{
  recepcionId: string;
  /** `true`: la misma recepción ya estaba registrada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Recibir mercadería en N3 o N4 (E9 §3.8): la recepción queda PENDIENTE de confirmar, con sus líneas y el control por línea, SIN stock (entra al confirmar,
 * `confirmarRecepcion`). Guard `recepciones.registrar` y la sucursal en el alcance; la empresa tiene que estar en N3 o N4 y con la perilla de su nivel encendida
 * en el plan. Repetición: misma clave y misma huella devuelve lo hecho (`yaExistia`) sin escribir ni auditar; misma clave con otro contenido, `CLAVE_REUTILIZADA`; el
 * mismo remito del mismo proveedor con otra clave, `REMITO_YA_REGISTRADO`. Dos pedidos iguales a la vez: gana uno y el otro ve su fila y repite.
 */
export function armarRegistrarRecepcion(dependencias: DependenciasDeCompras) {
  return async function registrarRecepcion(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarRecepcion,
  ): Promise<R<SalidaDeRegistrarRecepcion>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave)) return err("IDENTIFICADOR_INVALIDO");
    if (!esUuid(entrada.sucursalId) || !esUuid(entrada.proveedorId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const leidoHechoEn = leerHechoEn(entrada.hechoEn, contexto.ahora);
    if (!leidoHechoEn.ok) return leidoHechoEn;
    const hechoEn = leidoHechoEn.valor;
    let remito: Remito | null = null;
    if (entrada.remito !== undefined && entrada.remito !== null) {
      const leido = leerRemito(entrada.remito);
      if (!leido.ok) return leido;
      remito = leido.valor;
    }
    const renglones = leerRenglonesDeCompra(entrada.renglones);
    if (!renglones.ok) return renglones;
    const controles = leerControles(entrada.controles ?? [], renglones.valor.length);
    if (!controles.ok) return controles;
    const huella = huellaDeLaRecepcion({
      sucursalId: entrada.sucursalId,
      proveedorId: entrada.proveedorId,
      hechoEn: entrada.hechoEn === undefined ? null : entrada.hechoEn.toISOString(),
      remito,
      renglones: renglones.valor,
      controles: controles.valor,
    });

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeRegistrarRecepcion>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "recepciones.registrar",
          ]);
          if (!permiso.ok) return permiso;
          const sucursal = sucursalId(entrada.sucursalId);
          const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursal);
          if (!alcance.ok) return alcance;
          const fila = await tx.sucursales.obtener(empresaId, sucursal);
          if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
          if (!fila.activa) return err("SUCURSAL_INACTIVA");

          // El nivel y la perilla: solo N3 y N4, y solo si el plan los incluye (bajar de plan no toca lo cargado, pero no se carga más).
          const nivel = await exigirNivelSeparado(tx, contexto);
          if (!nivel.ok) return nivel;

          // Repetición: por la clave (el mismo gesto) y por el remito (el primer hecho manda, aunque cambie la clave).
          const repetida = await repeticion(
            tx,
            empresaId,
            entrada.clave,
            huella,
            remito,
            proveedorDe(entrada),
          );
          if (repetida !== null) return repetida;

          const proveedor = await directorio.parteParaOperacion(
            tx,
            empresaId,
            entrada.proveedorId,
            "PROVEEDOR",
          );
          if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
          const calculo = await calcularRenglones(tx, empresaId, renglones.valor, null, null);
          if (!calculo.ok) return calculo;
          const lineas = calculo.valor;

          const recepcionId = await tx.recepciones.insertar(empresaId, {
            estado: "PENDIENTE",
            sucursalId: sucursal,
            proveedorId: proveedor.valor.id,
            nivel: nivel.valor,
            esAtajo: false,
            remito,
            hechoEn,
            clave: entrada.clave,
            huella,
            registradoPor: persona,
          });
          if (recepcionId === undefined) {
            // Perdió una carrera: otra transacción ya escribió la misma clave o el mismo remito. Se vuelve a mirar (ya está confirmada su fila).
            const ganadora = await repeticion(
              tx,
              empresaId,
              entrada.clave,
              huella,
              remito,
              proveedorDe(entrada),
            );
            if (ganadora !== null) return ganadora;
            throw new Error(
              "la recepción chocó con una restricción única que no es la clave ni el remito",
            );
          }
          const guardadas: LineaDeRecepcion[] = lineas.map((l, i) => ({
            numero: i + 1,
            productoId: l.producto.id,
            presentacionId: l.renglon.presentacionId,
            unidadDeCompraId: l.renglon.unidadDeCompraId,
            cantidadDeCompra: l.renglon.cantidad,
            dePesoVariable: l.dePesoVariable,
            pesoReal: l.renglon.pesoReal,
            cantidadEnStock: l.cantidadEnStock,
            precioPorTipo: l.renglon.precio === null ? null : l.renglon.precioPor,
            unidadDePrecioId: l.renglon.precio === null ? null : l.renglon.unidadDePrecioId,
            precio: l.renglon.precio,
            importe: l.importe,
            costoPorUnidadDeStock: l.costoPorUnidadDeStock,
            depositoId: null,
            movimientoId: null,
          }));
          await tx.recepciones.insertarLineas(empresaId, recepcionId, guardadas);
          await tx.recepcionesSeparadas.insertarControles(empresaId, recepcionId, controles.valor);
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "RECEPCION_REGISTRADA",
            entidad: "recepcion",
            entidadId: recepcionId,
            despues: {
              proveedorId: proveedor.valor.id,
              sucursalId: entrada.sucursalId,
              nivel: nivel.valor,
              estado: "PENDIENTE",
              renglones: lineas.length,
              controles: controles.valor.length,
            },
          });
          return ok({ recepcionId, yaExistia: false });
        },
      ),
    );
  };
}

const proveedorDe = (entrada: EntradaDeRegistrarRecepcion): string => entrada.proveedorId;

/** ¿Ya estaba? Por la clave (misma huella: repetida; otra: reutilizada) y por el remito del mismo proveedor (el primer hecho manda). `null` si es nueva. */
async function repeticion(
  tx: Pick<TxDeCompras, "recepcionesSeparadas">,
  empresaId: ContextoOperativo["empresaId"],
  clave: string,
  huella: string,
  remito: Remito | null,
  proveedorId: string,
): Promise<R<SalidaDeRegistrarRecepcion> | null> {
  const previa = await tx.recepcionesSeparadas.porClaveSeparada(empresaId, clave);
  if (previa !== null) {
    if (decidirPorHuella(previa.huella, huella) !== "REPETIDA") return err("CLAVE_REUTILIZADA");
    return ok({ recepcionId: previa.id, yaExistia: true });
  }
  if (remito !== null) {
    const igual = await tx.recepcionesSeparadas.porRemitoSeparado(
      empresaId,
      proveedorId,
      remito.puntoDeVenta,
      remito.numero,
    );
    if (igual !== null) return err({ error: "REMITO_YA_REGISTRADO", recepcionId: igual.id });
  }
  return null;
}
