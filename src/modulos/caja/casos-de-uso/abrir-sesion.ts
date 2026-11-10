import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio, type ErrorDeJornada } from "../../../primitivas/tiempo/fecha-de-negocio";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal, type ErrorDeJornadaNoAbierta } from "../../cierre/publico";
import { datosDeJornada } from "../../empresas/publico";
import { esUuid } from "../dominio/identificadores";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeApertura,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import type { ErrorDeImporte } from "../dominio/importes";
import { decidirFondoInicial } from "../dominio/movimiento";
import { asegurarCajaPorDefectoEnTx } from "./caja-por-defecto";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  sucursalDeLaEntrada,
  repetirSiOtroGano,
  UNICAS_DE_LA_APERTURA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeAbrirSesion = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) devuelve la misma sesión. */
  claveDeIdempotencia: string;
  sucursalId: string;
  /** `null` solo en una sucursal sin cajas: se abre sobre la caja por defecto (e3 §3.2.1). */
  cajaId: string | null;
  fondoInicial: ImporteJson;
}>;

export type SalidaDeAbrirSesion = Readonly<{
  sesionId: string;
  fechaDeNegocio: string;
  /** `true`: ya se había abierto con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeImporte
  | ErrorDeJornada
  | ErrorDeJornadaNoAbierta
  | "CLAVE_REUTILIZADA"
  | "SUCURSAL_NO_ENCONTRADA"
  | "SUCURSAL_INACTIVA"
  | "CAJA_REQUERIDA"
  | "CAJA_NO_ENCONTRADA"
  | "CAJA_INACTIVA"
  | Readonly<{ codigo: "CAJA_YA_ABIERTA"; sesionId: string }>;

export type ErrorAlAbrirSesion =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el caso). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "CAJA_NO_ENCONTRADA",
  "CAJA_INACTIVA",
  "SUCURSAL_INACTIVA",
] as const;

/**
 * Abrir la sesión de una caja con su fondo inicial (e3 §3.2, §3.4 y §3.11.1). Contexto OPERATIVO con persona, en una transacción
 * serializable, con el orden fijo: guard (`sesiones_caja.abrir`), la empresa opera, alcance de sucursal, validación (clave, caja, fondo),
 * idempotencia (la clave, ANTES de mirar el estado: repetir el pedido devuelve la misma sesión con `yaExistia` y una clave con otro
 * contenido da `CLAVE_REUTILIZADA`) y las reglas:
 *  - la sucursal existe y está abierta (leída con `FOR SHARE`: un cierre concurrente espera);
 *  - la caja: con `cajaId` existe, es de la sucursal y está activa; sin `cajaId` la sucursal no tiene ninguna (si no, `CAJA_REQUERIDA`) y
 *    se asegura la caja por defecto en esta misma transacción;
 *  - ninguna sesión sin cerrar en esa caja (`CAJA_YA_ABIERTA { sesionId }`: dos aperturas a la vez, una abre y la otra recibe esto);
 *  - el sello de la jornada: la zona de la empresa y la hora de corte de la sucursal se leen EN esta transacción (sin caché) y la fecha
 *    de negocio sale de `fechaDeNegocio(ahora, …)`; con ese sello la jornada tiene que estar `ABIERTA` (`cierre.asegurarAbiertaEnTx`, que
 *    la crea si es la primera actividad y la toma con `FOR SHARE`): en auditoría o cerrada no se abre (`JORNADA_EN_AUDITORIA`,
 *    `JORNADA_CERRADA`);
 *  - se inserta la sesión (con el sello), su movimiento `FONDO_INICIAL` en efectivo y la auditoría `SESION_CAJA_ABIERTA`: todo o nada.
 * La auditoría no lleva la clave ni la huella.
 */
export function armarAbrirSesion({ transacciones, reglas }: DependenciasDeCaja) {
  return async function abrirSesion(
    contexto: ContextoOperativo,
    entrada: EntradaDeAbrirSesion,
  ): Promise<Resultado<SalidaDeAbrirSesion, ErrorAlAbrirSesion>> {
    const { empresaId, ahora } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeAbrirSesion,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES.abrirSesion.accion);
          if (!previo.ok) return previo;
          const sucursal = sucursalDeLaEntrada(entrada.sucursalId);
          if (!sucursal.ok) return sucursal;
          const alcance = await exigirAlcance(tx, contexto, sucursal.valor);
          if (!alcance.ok) return alcance;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          if (entrada.cajaId !== null && !esUuid(entrada.cajaId)) return err("CAJA_NO_ENCONTRADA");
          const fondo = decidirFondoInicial(entrada.fondoInicial);
          if (!fondo.ok) return fondo;

          const huella = huellaDeApertura({
            sucursalId: sucursal.valor,
            cajaId: entrada.cajaId,
            fondo: fondo.valor,
          });
          const previa = await tx.sesiones.obtenerPorClave(empresaId, clave.valor);
          const repeticion = decidirPorHuella(previa?.huella ?? null, huella);
          if (repeticion === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
          if (previa !== null) {
            return ok({
              sesionId: previa.id,
              fechaDeNegocio: previa.fechaDeNegocio,
              yaExistia: true,
            });
          }

          const deLaSucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
            empresaId,
            sucursal.valor,
          );
          if (deLaSucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
          if (!deLaSucursal.activa) return err("SUCURSAL_INACTIVA");

          let cajaId: string;
          if (entrada.cajaId === null) {
            if ((await tx.cajas.primeraDeLaSucursal(empresaId, sucursal.valor)) !== null) {
              return err("CAJA_REQUERIDA");
            }
            cajaId = (await asegurarCajaPorDefectoEnTx(tx, contexto, sucursal.valor)).cajaId;
          } else {
            const caja = await tx.cajas.obtener(empresaId, entrada.cajaId);
            if (caja === null || caja.sucursalId !== sucursal.valor)
              return err("CAJA_NO_ENCONTRADA");
            if (!caja.activa) return err("CAJA_INACTIVA");
            cajaId = caja.id;
          }
          const vigente = await tx.sesiones.vigenteDeLaCaja(empresaId, cajaId);
          if (vigente !== null) return err({ codigo: "CAJA_YA_ABIERTA", sesionId: vigente.id });

          // El sello: zona de la empresa y hora de corte de la sucursal, leídos en ESTA transacción (un cambio de corte ya confirmado rige).
          const datos = await datosDeJornada(tx, sucursal.valor);
          if (!datos.ok) return datos;
          const fecha = fechaDeNegocio(ahora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
          if (!fecha.ok) return fecha;
          const jornada = await jornadaDeSucursal.asegurarAbiertaEnTx(
            tx,
            empresaId,
            sucursal.valor,
            fecha.valor,
          );
          if (!jornada.ok) return jornada;

          const efectivo = await tx.mediosDePago.asegurarEfectivo(empresaId);
          if (efectivo.creado) {
            await dejarConstancia(tx, contexto, previo.valor.persona, {
              accion: "MEDIO_DE_PAGO_CREADO",
              entidad: "medio_de_pago",
              entidadId: efectivo.medio.id,
              despues: { tipo: "EFECTIVO", nombre: null, activo: true, origen: "caja" },
            });
          }
          const sesionId = await tx.sesiones.abrir({
            empresa: empresaId,
            cajaId,
            fechaDeNegocio: fecha.valor,
            horaDeCorte: datos.valor.horaDeCorte,
            zonaHoraria: datos.valor.zonaHoraria,
            abiertaEn: ahora,
            abiertaPor: previo.valor.persona,
            claveDeIdempotencia: clave.valor,
            huella,
          });
          await tx.movimientos.insertar({
            empresa: empresaId,
            sesionId,
            clase: "FONDO_INICIAL",
            medioDePagoId: efectivo.medio.id,
            cuentaDeCobroId: null,
            importe: fondo.valor,
            motivo: null,
            anulaA: null,
            corrigeJornada: null,
            registradoEn: ahora,
            registradoPor: previo.valor.persona,
            claveDeIdempotencia: null,
            huella: null,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "SESION_CAJA_ABIERTA",
            entidad: "sesion_caja",
            entidadId: sesionId,
            despues: {
              cajaId,
              sucursalId: sucursal.valor,
              fechaDeNegocio: fecha.valor,
              fondoInicial: importeATexto(fondo.valor),
            },
          });
          return ok({ sesionId, fechaDeNegocio: fecha.valor, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_APERTURA);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
