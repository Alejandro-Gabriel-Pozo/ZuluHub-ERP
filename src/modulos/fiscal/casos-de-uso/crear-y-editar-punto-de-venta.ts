import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  esUuid,
  puntoDeVentaId,
  type EmisorId,
  type PuntoDeVentaId,
} from "../dominio/identificadores";
import {
  editarPuntoDeVenta as editarEnElDominio,
  nuevoPuntoDeVenta,
  type ErrorDePuntoDeVenta,
  type PuntoDeVenta,
} from "../dominio/punto-de-venta";
import {
  exigirSucursalAbierta,
  type ErrorDeSucursalCerrada,
} from "../dominio/sucursales-de-la-emision";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import {
  cambiosParaAuditar,
  dejarListoElDomicilio,
  personaQueActua,
  type DomicilioDeEntrada,
  type ErrorDeDomicilioDeEntrada,
} from "./comun-de-configuracion";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";

// =================================================================================================
// Crear un punto de venta
// =================================================================================================

export type EntradaDeCrearPuntoDeVenta = Readonly<{
  /** El identificador del punto de venta, un uuid que genera la pantalla: es la clave de idempotencia del alta. */
  id: string;
  emisorId: EmisorId;
  sucursalId: SucursalId;
  numero: number;
  /** El domicilio del punto de venta (nuevo o existente). Sin domicilio nace igual, pero no se puede activar. */
  domicilio?: DomicilioDeEntrada | undefined;
}>;

export type SalidaDeCrearPuntoDeVenta = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  /** La versión del punto de venta (la que la pantalla manda al editarlo). */
  version: number;
  /** `true`: ya existía con esos datos; no se escribió nada ni se auditó. */
  yaExistia: boolean;
}>;

export type ErrorPropioAlCrearPuntoDeVenta =
  | ErrorDePuntoDeVenta
  | ErrorDeDomicilioDeEntrada
  | "ID_INVALIDO"
  | "ID_EN_USO"
  | "EMISOR_NO_ENCONTRADO"
  | ErrorDeSucursalCerrada;

export type ErrorAlCrearPuntoDeVenta =
  ErrorPropioAlCrearPuntoDeVenta | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al dar de alta y que es parte del contrato de este caso. */
const ADMITIDOS_AL_CREAR = [
  "PUNTO_DE_VENTA_DUPLICADO",
  "PUNTO_DE_VENTA_NUMERO_INVALIDO",
  "SUCURSAL_DE_OTRA_EMPRESA",
  "DOMICILIO_NO_ENCONTRADO",
  "EMISOR_NO_ENCONTRADO",
] as const;

/**
 * Dar de alta un punto de venta (spec H7 fiscal §B.5, §C y §G.3). Solo el gerente (`puntos_de_venta.crear`).
 * Contexto OPERATIVO con persona. En UNA transacción serializable: el guard primero, la empresa opera, la forma
 * del `id`, el emisor existe (es de esta empresa) y entonces:
 *
 *  - ya existe un punto de venta con ese `id` → si es del mismo emisor, la misma sucursal y el mismo número es la
 *    repetición (éxito, `yaExistia`, sin escribir, aunque la sucursal se haya cerrado después); si no, `ID_EN_USO`;
 *  - la sucursal elegida se lee con `FOR SHARE`: si no es de esta empresa, `SUCURSAL_DE_OTRA_EMPRESA`; si está cerrada
 *    (`activa = false`), `SUCURSAL_CERRADA` (el código de emitir desde una sucursal cerrada; ver abajo) y no se escribe nada, ni el
 *    domicilio nuevo (todo o nada);
 *  - si no, el dominio decide (`nuevoPuntoDeVenta`: sucursal de la empresa, número entre 1 y 99999, número libre
 *    en el emisor), se guarda con su domicilio nuevo si viene y se audita `PUNTO_DE_VENTA_CREADO`.
 *
 * Solo en una sucursal ABIERTA (decisión del dueño, 2026-10-29, cuestionario respondido a las 21:08:28Z: «¿Se puede crear un punto de
 * venta en una sucursal que está cerrada?» → «No: solo en sucursales abiertas»). La pantalla ya filtra la lista; el servidor no confía
 * en ella. La sucursal se lee con `FOR SHARE`: la clave foránea sola toma `FOR KEY SHARE`, que el cierre (un `UPDATE` de `activa`) no
 * espera, y bajo serializable un alta que leyó la sucursal abierta podía confirmar después de que su cierre confirmó. Con el bloqueo
 * el cierre espera al alta, o el alta repite y ve la sucursal cerrada. Sin ciclos de espera: el alta toma una sola sucursal y el
 * cierre (0005) no espera nada que el alta tenga que esperar. La base NO lo impone (ningún disparador de `punto_de_venta` mira la
 * sucursal): la protección es de aplicación.
 * Previene: un punto de venta en una sucursal cerrada, por un pedido armado a mano o por la carrera con su cierre.
 * Chequeo: `fiscal-configuracion-puntos-de-venta.test.ts` y los dos órdenes de la carrera en `fiscal-configuracion-concurrencia.test.ts`.
 *
 * Nace `INACTIVO` y en homologación (lo fija la base). Dos altas simultáneas del mismo número del mismo emisor:
 * gana una; la otra, tras el reintento serializable, ve el número ocupado (`PUNTO_DE_VENTA_DUPLICADO`). Un
 * número repetido en OTRO emisor de la misma empresa es válido (dos CUIT pueden tener el punto de venta 1).
 */
export function armarCrearPuntoDeVenta({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function crearPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearPuntoDeVenta,
  ): Promise<Resultado<SalidaDeCrearPuntoDeVenta, ErrorAlCrearPuntoDeVenta>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "dar de alta un punto de venta");
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCrearPuntoDeVenta,
          ErrorPropioAlCrearPuntoDeVenta | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.crearPuntoDeVenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        if (!esUuid(entrada.id)) return err("ID_INVALIDO");
        const id = puntoDeVentaId(entrada.id);

        const emisor = await tx.emisores.obtener(empresaId, entrada.emisorId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");

        const esLaRepeticion = (p: PuntoDeVenta) =>
          p.emisorId === emisor.id &&
          p.sucursalId === entrada.sucursalId &&
          p.numero === entrada.numero;
        const previo = await tx.puntosDeVenta.obtener(empresaId, id);
        if (previo !== null) {
          return esLaRepeticion(previo)
            ? ok({ puntoDeVentaId: id, version: previo.version, yaExistia: true })
            : err("ID_EN_USO");
        }

        // La sucursal, ANTES de escribir nada (ni el domicilio nuevo): de esta empresa (una de otra empresa o que no existe se dice igual,
        // sin oráculo) y abierta. Con `FOR SHARE`: ver arriba. Después de la repetición, que gana aunque la sucursal se haya cerrado.
        const sucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
          empresaId,
          entrada.sucursalId,
        );
        if (sucursal === null) return err("SUCURSAL_DE_OTRA_EMPRESA");
        const abierta = exigirSucursalAbierta(sucursal);
        if (!abierta.ok) return abierta;

        const domicilio =
          entrada.domicilio === undefined
            ? null
            : await dejarListoElDomicilio(tx, empresaId, entrada.domicilio);
        if (domicilio !== null && !domicilio.ok) return domicilio;

        const existentes = await tx.puntosDeVenta.listarDelEmisor(empresaId, emisor.id);
        const nuevo = nuevoPuntoDeVenta(
          {
            id,
            numero: entrada.numero,
            domicilioId: domicilio === null ? null : domicilio.valor,
          },
          emisor,
          { id: entrada.sucursalId, empresaId },
          existentes,
        );
        if (!nuevo.ok) return nuevo;

        const alta = await tx.puntosDeVenta.crear(nuevo.valor);
        if (!alta.ok) return alta;
        if (!alta.valor.creado) {
          // Otra alta del mismo `id` ganó entre la lectura y la escritura: es la repetición si pidió lo mismo.
          return esLaRepeticion(alta.valor.valor)
            ? ok({ puntoDeVentaId: id, version: alta.valor.valor.version, yaExistia: true })
            : err("ID_EN_USO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "PUNTO_DE_VENTA_CREADO",
          entidad: "punto_de_venta",
          entidadId: id,
          despues: {
            emisorId: emisor.id,
            sucursalId: entrada.sucursalId,
            numero: entrada.numero,
            domicilioId: nuevo.valor.domicilioId,
            estado: "INACTIVO",
          },
        });
        return ok({ puntoDeVentaId: id, version: alta.valor.valor.version, yaExistia: false });
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS_AL_CREAR);
  };
}

// =================================================================================================
// Editar un punto de venta
// =================================================================================================

export type EntradaDeEditarPuntoDeVenta = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  /** El número nuevo; solo cambia si ninguna serie del punto de venta se usó. */
  numero?: number | undefined;
  /** La sucursal nueva (de la misma empresa). El emisor no cambia nunca: no hay campo para eso. */
  sucursalId?: SucursalId | undefined;
  /** El domicilio nuevo (un domicilio no se edita: se crea otro o se elige uno existente). */
  domicilio?: DomicilioDeEntrada | undefined;
}>;

export type SalidaDeEditarPuntoDeVenta = Readonly<{
  /** La versión vigente después de la edición (o la actual, si no cambiaba nada). */
  version: number;
  /** `true`: lo pedido ya era así; no se escribió nada ni se auditó. */
  sinCambios: boolean;
}>;

export type ErrorPropioAlEditarPuntoDeVenta =
  | ErrorDePuntoDeVenta
  | ErrorDeDomicilioDeEntrada
  | "PUNTO_DE_VENTA_NO_ENCONTRADO"
  | "VERSION_DESACTUALIZADA";

export type ErrorAlEditarPuntoDeVenta =
  ErrorPropioAlEditarPuntoDeVenta | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al editar y que es parte del contrato de este caso. */
const ADMITIDOS_AL_EDITAR = [
  "PUNTO_DE_VENTA_DUPLICADO",
  "PUNTO_DE_VENTA_NUMERO_INVALIDO",
  "PUNTO_DE_VENTA_NUMERO_INMUTABLE",
  "SUCURSAL_DE_OTRA_EMPRESA",
  "DOMICILIO_NO_ENCONTRADO",
] as const;

/**
 * Cambiar el número, la sucursal o el domicilio de un punto de venta (spec H7 fiscal §B.5 y §C). Solo el gerente
 * (`puntos_de_venta.editar`). Contexto OPERATIVO con persona. En UNA transacción serializable: el guard primero,
 * la empresa opera, el punto de venta existe y el dominio decide (`editarPuntoDeVenta`: sucursal de la empresa,
 * número válido, libre en el emisor y SIN números usados):
 *
 *  - lo pedido no cambia nada → éxito sin escribir ni auditar (repetir una edición ya aplicada es idempotente,
 *    aunque la versión esperada haya quedado vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`;
 *  - si no, `UPDATE` condicionado a la versión y auditoría `PUNTO_DE_VENTA_EDITADO` con el antes y el después de
 *    lo que cambió.
 *
 * Dos ediciones simultáneas con la misma versión: gana una; la otra, tras el reintento serializable, ve la
 * versión nueva y da `VERSION_DESACTUALIZADA`. Cambiar el número mientras otro proceso reserva un número de su
 * serie: o el cambio entra antes, o la base lo rechaza (`PUNTO_DE_VENTA_NUMERO_INMUTABLE`); nunca queda a medias.
 */
export function armarEditarPuntoDeVenta({
  transacciones,
  reglas,
}: DependenciasDeConfiguracionFiscal) {
  return async function editarPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarPuntoDeVenta,
  ): Promise<Resultado<SalidaDeEditarPuntoDeVenta, ErrorAlEditarPuntoDeVenta>> {
    const { empresaId } = contexto;
    const persona = personaQueActua(contexto.personaId, "editar un punto de venta");
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeEditarPuntoDeVenta,
          ErrorPropioAlEditarPuntoDeVenta | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONFIGURACION.editarPuntoDeVenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;

        const actual = await tx.puntosDeVenta.obtener(empresaId, entrada.puntoDeVentaId);
        if (actual === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");

        const domicilio =
          entrada.domicilio === undefined
            ? null
            : await dejarListoElDomicilio(tx, empresaId, entrada.domicilio);
        if (domicilio !== null && !domicilio.ok) return domicilio;

        const decision = editarEnElDominio(
          actual,
          {
            ...(entrada.numero === undefined ? {} : { numero: entrada.numero }),
            ...(entrada.sucursalId === undefined
              ? {}
              : { sucursal: { id: entrada.sucursalId, empresaId } }),
            ...(domicilio === null ? {} : { domicilioId: domicilio.valor }),
          },
          {
            tieneNumerosUsados: await tx.series.hayNumerosUsadosDelPuntoDeVenta(
              empresaId,
              actual.id,
            ),
            delEmisor: await tx.puntosDeVenta.listarDelEmisor(empresaId, actual.emisorId),
          },
        );
        if (!decision.ok) return decision;
        if (!decision.valor.cambio) return ok({ version: actual.version, sinCambios: true });
        if (actual.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");

        const editado = decision.valor.puntoDeVenta;
        const guardado = await tx.puntosDeVenta.guardar(editado);
        if (guardado === null) return err("VERSION_DESACTUALIZADA");
        const cambios = cambiosParaAuditar(
          { numero: actual.numero, sucursalId: actual.sucursalId, domicilioId: actual.domicilioId },
          {
            numero: editado.numero,
            sucursalId: editado.sucursalId,
            domicilioId: editado.domicilioId,
          },
        );
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "PUNTO_DE_VENTA_EDITADO",
          entidad: "punto_de_venta",
          entidadId: actual.id,
          antes: { emisorId: actual.emisorId, ...cambios.antes },
          despues: { emisorId: actual.emisorId, ...cambios.despues },
        });
        return ok({ version: guardado.version, sinCambios: false });
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS_AL_EDITAR);
  };
}
