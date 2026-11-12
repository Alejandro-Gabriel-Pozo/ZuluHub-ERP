import type { ContextoOperativo } from "../../../contexto/contexto";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import { ZONA_DE_ARGENTINA } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { decidirCambioDeCalidad, esCalidadDeLote } from "../dominio/calidad";
import { diferenciasDeApertura } from "../dominio/vencimientos";
import { DECIMALES_DE_CANTIDAD } from "../dominio/movimiento";
import { esUuid } from "../persistencia/filas";
import type { ModoDeControl } from "../persistencia/repositorio-de-lotes";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { idDerivado } from "./id-derivado";
import { leerDetalle } from "./movimientos-comun";
import { exigirPerillaDeLotes } from "./perillas-de-stock";

type R<S> = Resultado<S, ErrorDeStock>;

const MODOS: readonly ModoDeControl[] = ["LOTE", "LOTE_Y_VENCIMIENTO"];
const esModo = (valor: unknown): valor is ModoDeControl =>
  typeof valor === "string" && (MODOS as readonly string[]).includes(valor);

const aTexto = (unidades: bigint): string => formatearDecimalFijo(unidades, DECIMALES_DE_CANTIDAD);

// ---- controlar ------------------------------------------------------------------------------------------------------------------

export type EntradaDeControlarLote = Readonly<{
  productoId: string;
  modo: ModoDeControl;
  conCalidad: boolean;
}>;
export type SalidaDeControlarLote = Readonly<{ articuloId: string; yaExistia: boolean }>;

/**
 * Controlar por lote el stock de un artículo (E6 §3.2, D26: «los que se declaren, uno por uno»). Guard `lotes.controlar`, alcance TODAS (el
 * control es de la empresa), perilla `lotes` (y `calidad_de_lote` si lleva calidad). Si el artículo ya tiene existencia crea el lote «sin
 * asignar» y una reasignación de apertura por depósito con diferencia (puede ser negativa), todo en la misma transacción: a partir de ahí los
 * lotes suman el saldo (la base lo exige al confirmar). Un control que estuvo apagado se reactiva con el MISMO criterio: lo que se movió mientras
 * estuvo congelado (DEC-0104) entra al «sin asignar». Repetición (`YA_ESTABA`): el mismo control activo devuelve `yaExistia` sin escribir ni
 * auditar. Dos a la vez sobre el mismo artículo se serializan por el bloqueo del artículo.
 */
export function armarControlarLote(dependencias: DependenciasDeStock) {
  return async function controlarLote(
    contexto: ContextoOperativo,
    entrada: EntradaDeControlarLote,
  ): Promise<R<SalidaDeControlarLote>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeControlarLote>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["lotes.controlar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) {
          return err("PRODUCTO_NO_ENCONTRADO");
        }
        if (!esModo(entrada.modo) || typeof entrada.conCalidad !== "boolean") {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const articulo = await tx.articulosDeStock.bloquearPorProducto(
          empresaId,
          entrada.productoId.toLowerCase(),
        );
        if (articulo === null || !articulo.activo) return err("ARTICULO_NO_CONTROLADO");
        const control = await tx.lotesDeStock.bloquearControl(empresaId, articulo.id);
        if (
          control !== null &&
          control.activo &&
          control.modo === entrada.modo &&
          control.conCalidad === entrada.conCalidad
        ) {
          return ok({ articuloId: articulo.id, yaExistia: true });
        }
        const perilla = await exigirPerillaDeLotes(tx, contexto, "lotes");
        if (!perilla.ok) return perilla;
        if (entrada.conCalidad) {
          const conCalidad = await exigirPerillaDeLotes(tx, contexto, "calidad_de_lote");
          if (!conCalidad.ok) return conCalidad;
        }
        const nuevo =
          control === null
            ? null
            : await tx.lotesDeStock.cambiarControl(empresaId, articulo.id, {
                modo: entrada.modo,
                conCalidad: entrada.conCalidad,
                activo: true,
              });
        if (control === null) {
          await tx.lotesDeStock.crearControl(empresaId, {
            articuloId: articulo.id,
            modo: entrada.modo,
            conCalidad: entrada.conCalidad,
          });
        }
        const version = nuevo?.version ?? 1;
        // El lote «sin asignar»: uno por artículo, con id derivado (un reintento escribe el mismo).
        let sinAsignar = await tx.lotesDeStock.sinAsignar(empresaId, articulo.id);
        if (sinAsignar === null) {
          const primerIngreso = fechaDeNegocio(contexto.ahora, ZONA_DE_ARGENTINA, "00:00");
          if (!primerIngreso.ok)
            throw new RangeError("stock: el instante del contexto no tiene fecha");
          const alta = await tx.lotesDeStock.buscarOCrear(empresaId, {
            id: idDerivado(`lote-sin-asignar|${articulo.id}`),
            articuloId: articulo.id,
            codigo: "SIN_ASIGNAR",
            referenciaDeOrigen: null,
            fechaDeElaboracion: null,
            fechaDeVencimiento: null,
            esSinAsignar: true,
            fechaDePrimerIngreso: primerIngreso.valor,
            creadoPor: persona,
            creadoEn: contexto.ahora,
          });
          sinAsignar = alta.lote.id;
        }
        // La apertura: lo que el libro tiene y los lotes todavía no suman, por depósito.
        const diferencias = diferenciasDeApertura(
          await tx.lotesDeStock.existenciaDelLibroPorDeposito(empresaId, articulo.id),
          await tx.lotesDeStock.sumaDeLotesPorDeposito(empresaId, articulo.id),
        );
        for (const d of diferencias) {
          await tx.lotesDeStock.registrarReasignacion(empresaId, {
            id: idDerivado(`apertura|${articulo.id}|${d.depositoId}|v${version}`),
            depositoId: d.depositoId,
            articuloId: articulo.id,
            loteOrigenId: null,
            loteDestinoId: sinAsignar,
            cantidad: aTexto(d.unidades),
            motivo: "Apertura del control de lote",
            clave: `apertura-${articulo.id}-${d.depositoId}-v${version}`,
            por: persona,
            en: contexto.ahora,
          });
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "LOTE_CONTROLADO",
          entidad: "control_de_lote",
          entidadId: articulo.id,
          antes:
            control === null
              ? null
              : { modo: control.modo, conCalidad: control.conCalidad, activo: control.activo },
          despues: {
            modo: entrada.modo,
            conCalidad: entrada.conCalidad,
            activo: true,
            apertura: diferencias.map((d) => ({
              depositoId: d.depositoId,
              cantidad: aTexto(d.unidades),
            })),
          },
        });
        return ok({ articuloId: articulo.id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

// ---- dejar de controlar ---------------------------------------------------------------------------------------------------------

export type EntradaDeDejarDeControlarLote = Readonly<{ productoId: string }>;
export type SalidaDeDejarDeControlarLote = Readonly<{ yaEstaba: boolean }>;

/**
 * Dejar de controlar por lote (E6 §3.2): NO borra nada; el control queda inactivo y los lotes y saldos siguen consultables. Mientras esté
 * apagado el libro no pide ni toca lotes (DEC-0104, S-16: «lotes congelados»); reactivar re-abre con lo que se movió. Guard
 * `lotes.dejar_de_controlar`, alcance TODAS. Repetición (`YA_ESTABA`): sin control o ya apagado devuelve `yaEstaba` sin escribir ni auditar.
 */
export function armarDejarDeControlarLote(dependencias: DependenciasDeStock) {
  return async function dejarDeControlarLote(
    contexto: ContextoOperativo,
    entrada: EntradaDeDejarDeControlarLote,
  ): Promise<R<SalidaDeDejarDeControlarLote>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeDejarDeControlarLote>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "lotes.dejar_de_controlar",
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) {
          return err("PRODUCTO_NO_ENCONTRADO");
        }
        const articulo = await tx.articulosDeStock.bloquearPorProducto(
          empresaId,
          entrada.productoId.toLowerCase(),
        );
        if (articulo === null) return ok({ yaEstaba: true });
        const control = await tx.lotesDeStock.bloquearControl(empresaId, articulo.id);
        if (control === null || !control.activo) return ok({ yaEstaba: true });
        await tx.lotesDeStock.cambiarControl(empresaId, articulo.id, {
          modo: control.modo,
          conCalidad: control.conCalidad,
          activo: false,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "LOTE_DEJADO_DE_CONTROLAR",
          entidad: "control_de_lote",
          entidadId: articulo.id,
          antes: { modo: control.modo, conCalidad: control.conCalidad, activo: true },
          despues: { modo: control.modo, conCalidad: control.conCalidad, activo: false },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

// ---- calidad --------------------------------------------------------------------------------------------------------------------

export type EntradaDeCambiarCalidad = Readonly<{
  loteId: string;
  estado: string;
  /** Por qué se cambia: obligatorio (queda en la historia). */
  motivo: string;
  /** La versión del lote que vio la persona: si cambió y el estado pedido no es ya el vigente, `LOTE_DESACTUALIZADO`. */
  versionEsperada: number;
}>;
export type SalidaDeCambiarCalidad = Readonly<{ yaEstaba: boolean }>;

/**
 * Cambiar la calidad de un lote (E6 §3.2, D27, D118): cualquier estado a cualquier otro, SIEMPRE con motivo; solo cambia el estado del lote, no
 * mueve stock de depósito (S-4). Guard `lotes.cambiar_calidad`, alcance TODAS; el artículo tiene que llevar calidad (`LOTE_SIN_CALIDAD`).
 * El lote se bloquea `FOR UPDATE`: una venta que lo está eligiendo espera (o se repite y lo saltea). Repetición (`YA_ESTABA`): el mismo estado
 * que ya tiene devuelve `yaEstaba` sin escribir ni auditar, aunque la versión esperada sea vieja; la versión protege de pisar el cambio de otra
 * persona. La idempotencia es por estado y versión (no hay clave guardada: la historia no la tiene).
 */
export function armarCambiarCalidadDeLote(dependencias: DependenciasDeStock) {
  return async function cambiarCalidadDeLote(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarCalidad,
  ): Promise<R<SalidaDeCambiarCalidad>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarCalidad>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "lotes.cambiar_calidad",
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (typeof entrada.loteId !== "string" || !esUuid(entrada.loteId)) {
          return err("LOTE_NO_ENCONTRADO");
        }
        if (typeof entrada.estado !== "string" || !esCalidadDeLote(entrada.estado)) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        if (
          typeof entrada.versionEsperada !== "number" ||
          !Number.isSafeInteger(entrada.versionEsperada) ||
          entrada.versionEsperada < 1
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const motivo = leerDetalle(entrada.motivo, true);
        if (!motivo.ok) return err("MOTIVO_REQUERIDO");
        const lote = await tx.lotesDeStock.bloquearLote(empresaId, entrada.loteId.toLowerCase());
        if (lote === null) return err("LOTE_NO_ENCONTRADO");
        const control = (await tx.lotesDeStock.controlesDe(empresaId, [lote.articuloId])).get(
          lote.articuloId,
        );
        if (lote.esSinAsignar || control === undefined || !control.conCalidad) {
          return err("LOTE_SIN_CALIDAD");
        }
        const decision = decidirCambioDeCalidad(lote.calidad, entrada.estado, motivo.valor ?? "");
        if (!decision.ok) return err("MOTIVO_REQUERIDO");
        if (decision.valor === "YA_ESTABA") return ok({ yaEstaba: true });
        if (lote.version !== entrada.versionEsperada) return err("LOTE_DESACTUALIZADO");
        await tx.lotesDeStock.registrarCalidad(empresaId, {
          loteId: lote.id,
          estado: entrada.estado,
          motivo: motivo.valor ?? "",
          por: persona,
          en: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "LOTE_CALIDAD_CAMBIADA",
          entidad: "lote",
          entidadId: lote.id,
          antes: { calidad: lote.calidad },
          despues: { calidad: entrada.estado, motivo: motivo.valor },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
