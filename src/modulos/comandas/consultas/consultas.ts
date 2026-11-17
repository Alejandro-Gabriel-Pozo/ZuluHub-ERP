import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa, datosDeJornada } from "../../empresas/publico";
import { esUuid } from "../../ventas/publico";
import {
  documentoDeAnulacion,
  documentoDeComanda,
  documentoDeTicket,
  type ErrorDeCantidadParaPapel,
  type ModeloDePapel,
} from "../dominio/documento";
import {
  tipoDeDocumento,
  usoParaElDocumento,
  type PapelEnMm,
  type TipoDeDocumento,
} from "../dominio/impresion";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { DependenciasDeConsultasDeComandas, TxDeConsultasDeComandas } from "./contrato";

export type ErrorDeConsultaDeComandas =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia
  | ErrorDeCantidadParaPapel
  | "IDENTIFICADOR_INVALIDO"
  | "DOCUMENTO_INVALIDO"
  | "ENVIO_NO_ENCONTRADO"
  | "CUENTA_NO_ENCONTRADA"
  | "DOCUMENTO_NO_ENCONTRADO"
  | "SUCURSAL_NO_ENCONTRADA"
  | "IMPRESORA_NO_ENCONTRADA";

type R<S> = Resultado<S, ErrorDeConsultaDeComandas>;
type Previo = Readonly<{ alcance: "TODAS" | readonly SucursalId[] }>;

/** El guard (la acción de la consulta), que la empresa opere y el alcance de sucursales de quien pide: lo primero de toda consulta. */
async function previo(
  tx: TxDeConsultasDeComandas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeComandas,
  accion: ClaveAccion,
): Promise<Resultado<Previo, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAccion(dependencias.reglas, accion, () =>
    tx.autorizacion.delActor(contexto),
  );
  if (!permiso.ok) return permiso;
  const opera = comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
  if (!opera.ok) return opera;
  return ok({ alcance: await tx.autorizacion.sucursalesDelActor(contexto) });
}

/** «09/11/2026 01:25»: la hora del envío en la zona de la empresa (la que ve el cocinero, no UTC). */
function fechaYHora(instante: Date, zona: string): string {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: zona,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${de("day")}/${de("month")}/${de("year")} ${de("hour")}:${de("minute")}`;
}

export type EntradaDeDocumentoParaImprimir = Readonly<{
  documentoTipo: string;
  documentoId: string;
  /** El papel es la copia: lleva «Copia» y la hora del envío ORIGINAL (nunca la de ahora). */
  copia?: boolean | undefined;
  /** La impresora elegida (da el ancho del papel); sin ella, la de ese uso de la sucursal, o 80 mm. */
  impresoraId?: string | undefined;
}>;

export function crearConsultasDeComandas(dependencias: DependenciasDeConsultasDeComandas) {
  const leer = <T>(
    contexto: ContextoOperativo,
    accion: ClaveAccion,
    trabajo: (tx: TxDeConsultasDeComandas, p: Previo) => Promise<R<T>>,
  ) =>
    dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx) => {
        const p = await previo(tx, contexto, dependencias, accion);
        return p.ok ? trabajo(tx, p.valor) : p;
      },
    );

  async function anchoDe(
    tx: TxDeConsultasDeComandas,
    contexto: ContextoOperativo,
    sucursal: string,
    tipo: TipoDeDocumento,
    impresoraId: string | undefined,
  ): Promise<R<PapelEnMm>> {
    if (impresoraId !== undefined) {
      const i = await tx.impresion.impresoraPorId(contexto.empresaId, impresoraId);
      return i === null || i.sucursalId !== sucursal
        ? err("IMPRESORA_NO_ENCONTRADA")
        : ok(i.papelMm);
    }
    const de = await tx.impresion.impresorasDeSucursal(contexto.empresaId, sucursal, {
      uso: usoParaElDocumento(tipo),
    });
    return ok(de[0]?.papelMm ?? 80);
  }

  return {
    fichaDeEnvio: (contexto: ContextoOperativo, entrada: Readonly<{ envioId: string }>) =>
      leer(contexto, "comandas.ver", async (tx, p) => {
        if (!esUuid(entrada.envioId)) return err("IDENTIFICADOR_INVALIDO");
        const envio = await tx.envios.envioPorId(contexto.empresaId, entrada.envioId);
        if (envio === null) return err("ENVIO_NO_ENCONTRADO");
        const alcance = exigirSucursal(p.alcance, sucursalId(envio.sucursalId));
        if (!alcance.ok) return alcance;
        const renglones = await tx.envios.renglonesDeEnvio(contexto.empresaId, envio.id);
        return ok({ envio, renglones });
      }),

    enviosDeCuenta: (contexto: ContextoOperativo, entrada: Readonly<{ cuentaId: string }>) =>
      leer(contexto, "comandas.ver", async (tx, p) => {
        if (!esUuid(entrada.cuentaId)) return err("IDENTIFICADOR_INVALIDO");
        const cuenta = await tx.cuentas.obtener(contexto.empresaId, entrada.cuentaId as never);
        if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
        const alcance = exigirSucursal(p.alcance, cuenta.sucursalId);
        if (!alcance.ok) return alcance;
        return ok(await tx.envios.enviosDeCuenta(contexto.empresaId, cuenta.id));
      }),

    /**
     * El papel de un documento (E7 §3.5 y §3.10), armado SOLO desde las fotos guardadas (envío y renglones, aviso, ticket), nunca del catálogo vivo: la
     * reimpresión sale idéntica aunque después cambie un nombre o un precio. La fecha y la hora son las DEL ENVÍO, en la zona de la empresa, también en
     * la copia. Lo imprime el navegador con el diálogo del sistema (PP-1).
     */
    documentoParaImprimir: (contexto: ContextoOperativo, entrada: EntradaDeDocumentoParaImprimir) =>
      leer(contexto, "comandas.ver", async (tx, p): Promise<R<ModeloDePapel>> => {
        if (
          !esUuid(entrada.documentoId) ||
          (entrada.impresoraId !== undefined && !esUuid(entrada.impresoraId))
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const tipo = tipoDeDocumento(entrada.documentoTipo);
        if (!tipo.ok) return tipo;
        const copia = entrada.copia === true;
        const { empresaId } = contexto;
        const persona = async (id: string): Promise<string> =>
          (await tx.personas?.obtener(id as never))?.email ?? id;
        const zona = async (sucursal: string) => {
          const d = await datosDeJornada(tx, sucursalId(sucursal));
          return d.ok ? ok(d.valor.zonaHoraria) : d;
        };
        if (tipo.valor === "COMANDA") {
          const envio = await tx.envios.envioPorId(empresaId, entrada.documentoId);
          if (envio === null) return err("DOCUMENTO_NO_ENCONTRADO");
          const alcance = exigirSucursal(p.alcance, sucursalId(envio.sucursalId));
          if (!alcance.ok) return alcance;
          const z = await zona(envio.sucursalId);
          if (!z.ok) return z;
          const ancho = await anchoDe(
            tx,
            contexto,
            envio.sucursalId,
            "COMANDA",
            entrada.impresoraId,
          );
          if (!ancho.ok) return ancho;
          const renglones = await tx.envios.renglonesDeEnvio(empresaId, envio.id);
          const lineas = await Promise.all(
            renglones.map((r) => tx.cuentas.obtenerLinea(empresaId, r.lineaId as never)),
          );
          const papel = documentoDeComanda(
            {
              numero: envio.numero,
              tipo: envio.tipo,
              rotulo: envio.rotulo,
              enviadoEn: fechaYHora(envio.enviadoEn, z.valor),
              tomadoPor: await persona(envio.enviadoPor),
            },
            renglones.map((r, i) => ({
              cantidad: r.cantidad,
              unidadDeVenta: lineas[i]?.unidadDeVenta ?? "UNIDAD",
              paso: lineas[i]?.pasoDeCantidad ?? "1",
              nombreDeCocina: r.nombreDeCocina,
              detalle: r.detalleDeCocina,
              rol: r.rol,
            })),
            { copia, ancho: ancho.valor },
          );
          return papel;
        }
        if (tipo.valor === "ANULACION") {
          const aviso = await tx.envios.avisoPorId(empresaId, entrada.documentoId);
          if (aviso === null) return err("DOCUMENTO_NO_ENCONTRADO");
          const cuenta = await tx.cuentas.obtener(empresaId, aviso.cuentaId as never);
          if (cuenta === null) return err("DOCUMENTO_NO_ENCONTRADO");
          const alcance = exigirSucursal(p.alcance, cuenta.sucursalId);
          if (!alcance.ok) return alcance;
          const z = await zona(cuenta.sucursalId);
          if (!z.ok) return z;
          const ancho = await anchoDe(
            tx,
            contexto,
            cuenta.sucursalId,
            "ANULACION",
            entrada.impresoraId,
          );
          if (!ancho.ok) return ancho;
          const envio = await tx.envios.envioPorId(empresaId, aviso.envioId);
          const linea = await tx.cuentas.obtenerLinea(empresaId, aviso.lineaOrigenId as never);
          if (envio === null || linea === null) return err("DOCUMENTO_NO_ENCONTRADO");
          return documentoDeAnulacion(
            {
              rotulo: aviso.rotulo,
              envioNumero: envio.numero,
              enviadoEn: fechaYHora(envio.enviadoEn, z.valor),
              anuladoPor: await persona(aviso.anuladoPor),
              cantidadAnulada: aviso.cantidad,
              quedan: aviso.quedan,
              unidadDeVenta: linea.unidadDeVenta,
              paso: linea.pasoDeCantidad,
              nombreDeCocina: aviso.nombreDeCocina,
              detalle: aviso.detalleDeCocina,
              motivo: aviso.motivo,
            },
            { copia, ancho: ancho.valor },
          );
        }
        const ficha = await tx.lecturasDeVentas.fichaDeTicket(empresaId, entrada.documentoId);
        if (ficha === null) return err("DOCUMENTO_NO_ENCONTRADO");
        const alcance = exigirSucursal(p.alcance, ficha.ticket.sucursalId);
        if (!alcance.ok) return alcance;
        const ancho = await anchoDe(
          tx,
          contexto,
          ficha.ticket.sucursalId,
          "TICKET",
          entrada.impresoraId,
        );
        if (!ancho.ok) return ancho;
        return ok(
          documentoDeTicket(
            {
              numero: ficha.ticket.numero,
              fecha: ficha.ticket.fechaNegocio,
              lineas: ficha.renglonesDelVigente.map((r) => ({
                cantidad: r.cantidad,
                descripcion: r.descripcion,
                importe: r.importe,
              })),
              total: ficha.ejemplares[0]?.total ?? ficha.ticket.total,
            },
            { ancho: ancho.valor },
          ),
        );
      }),

    trabajosDeImpresion: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ documentoId: string }>,
    ) =>
      leer(contexto, "comandas.ver", async (tx, p) => {
        if (!esUuid(entrada.documentoId)) return err("IDENTIFICADOR_INVALIDO");
        const trabajos = await tx.impresion.trabajosDeDocumento(
          contexto.empresaId,
          entrada.documentoId,
        );
        const visibles = trabajos.filter(
          (t) => exigirSucursal(p.alcance, sucursalId(t.sucursalId)).ok,
        );
        return ok(visibles);
      }),

    impresorasDeLaSucursal: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ sucursalId: string; incluirInactivas?: boolean | undefined }>,
    ) =>
      leer(contexto, "impresoras.ver", async (tx, p) => {
        if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
        const alcance = exigirSucursal(p.alcance, sucursalId(entrada.sucursalId));
        if (!alcance.ok) return alcance;
        return ok(
          await tx.impresion.impresorasDeSucursal(contexto.empresaId, entrada.sucursalId, {
            incluirInactivas: entrada.incluirInactivas === true,
          }),
        );
      }),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeComandas = ReturnType<typeof crearConsultasDeComandas>;
