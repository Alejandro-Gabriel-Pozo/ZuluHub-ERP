import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import {
  calcularLasLineas,
  cuentasAbiertasPorAncla,
  esUuid,
  type CuentaAbiertaDeAncla,
} from "../../ventas/publico";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { ANCLA_DE_MESA } from "../casos-de-uso/cuenta-de-mesa";
import { estadoDeMesa, type EstadoDeMesa } from "../dominio/estado-de-mesa";
import type { Mesa } from "../persistencia/repositorio-de-mesas";
import type { DependenciasDeConsultasDeSalon, TxDeConsultasDeSalon } from "./contrato";

export type ErrorDeConsultaDeSalon =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia
  | "IDENTIFICADOR_INVALIDO"
  | "MESA_NO_ENCONTRADA";

type R<S> = Resultado<S, ErrorDeConsultaDeSalon>;

const ARS = "ARS";
const importe = (monto: string): ImporteJson => ({ moneda: ARS, monto });

export type FiltroDelMapa = "TODAS" | "LIBRES" | "EN_PEDIDO" | "OCUPADAS";
export type EntradaDeMapaDeMesas = Readonly<{
  sucursalId: string;
  filtro?: FiltroDelMapa | undefined;
}>;

export type MesaDelMapa = Readonly<{
  mesaId: string;
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
  estado: EstadoDeMesa;
  /** La cuenta abierta de la mesa (ausente si está libre, unida o dividida). */
  cuentaId?: string;
  total?: ImporteJson;
  /** Quién abrió la cuenta (su nombre sale de identidad cuando ofrezca esa lectura: D-ID-1). */
  mozoId?: string;
  minutosAbierta?: number;
  /** «Unida a la mesa N»: el número de la mesa destino. */
  unidaAMesa?: number;
  /** Las cuentas hijas abiertas de una mesa dividida. */
  cuentasHijas?: readonly Readonly<{ cuentaId: string; numero: number; total: ImporteJson }>[];
}>;

export type EntradaDeFichaDeMesa = Readonly<{ mesaId: string }>;

export type LineaDeLaFicha = Readonly<{
  lineaId: string;
  posicion: number;
  descripcion: string;
  varianteNombre: string | null;
  cantidad: string;
  precioUnitario: string;
  importe: string;
  /** El importe de una línea compartida entre cuentas («Compartido»). */
  compartida: boolean;
  /** Estado de comanda: lo que falta enviar, lo que espera y lo enviado con su número de envío. */
  comanda: "PARA_ENVIAR" | "ESPERA" | "ENVIADA";
  numeroDeEnvio: number | null;
  /** «De la mesa N»: el número de la mesa de la que vino el ítem por una unión. */
  deLaMesa: number | null;
}>;

export type CuentaDeLaFicha = Readonly<{
  cuentaId: string;
  /** Número de la parte («Cuenta 2») si es una cuenta hija de una división. */
  parte: number | null;
  total: ImporteJson;
  lineas: readonly LineaDeLaFicha[];
}>;

export type FichaDeMesa = Readonly<{
  mesaId: string;
  numero: number;
  estado: EstadoDeMesa;
  unidaAMesa: number | null;
  cuentas: readonly CuentaDeLaFicha[];
}>;

export type EntradaDeListarMesas = Readonly<{
  sucursalId: string;
  incluirInactivas?: boolean | undefined;
}>;

/** El guard (`mesas.ver`), que la empresa opere y el alcance de sucursales de quien pide: lo primero de toda consulta. */
async function previo(
  tx: TxDeConsultasDeSalon,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeSalon,
): Promise<Resultado<"TODAS" | readonly SucursalId[], MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAccion(dependencias.reglas, "mesas.ver", () =>
    tx.autorizacion.delActor(contexto),
  );
  if (!permiso.ok) return permiso;
  const opera = comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
  if (!opera.ok) return opera;
  return ok(await tx.autorizacion.sucursalesDelActor(contexto));
}

export function crearConsultasDeSalon(dependencias: DependenciasDeConsultasDeSalon) {
  return {
    /** La lista de administración de las mesas de la sucursal, por número (sin las desactivadas salvo que se pidan). */
    listarMesas: (contexto: ContextoOperativo, entrada: EntradaDeListarMesas): Promise<R<Mesa[]>> =>
      dependencias.transacciones.ejecutar<Mesa[], ErrorDeConsultaDeSalon>(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx) => {
          const alcance = await previo(tx, contexto, dependencias);
          if (!alcance.ok) return alcance;
          if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
          const permitida = exigirSucursal(alcance.valor, sucursalId(entrada.sucursalId));
          if (!permitida.ok) return permitida;
          return ok(
            await tx.mesas.listar(
              contexto.empresaId,
              sucursalId(entrada.sucursalId),
              entrada.incluirInactivas === true,
            ),
          );
        },
      ),

    /**
     * El mapa de mesas de la sucursal (E7 §3.6): cada mesa activa con su estado DERIVADO de sus cuentas y envíos (no se guarda), en UNA pasada de lecturas
     * en lote (el mapa no hace una consulta por mesa). Filtros aprobados: todas, libres, en pedido, ocupadas.
     */
    mapaDeMesas: (
      contexto: ContextoOperativo,
      entrada: EntradaDeMapaDeMesas,
    ): Promise<R<MesaDelMapa[]>> =>
      dependencias.transacciones.ejecutar<MesaDelMapa[], ErrorDeConsultaDeSalon>(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx) => {
          const alcance = await previo(tx, contexto, dependencias);
          if (!alcance.ok) return alcance;
          if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
          const sucursal = sucursalId(entrada.sucursalId);
          const permitida = exigirSucursal(alcance.valor, sucursal);
          if (!permitida.ok) return permitida;
          const { empresaId } = contexto;
          const mesas = await tx.mesas.listar(empresaId, sucursal, false);
          const abiertas = new Map<string, CuentaAbiertaDeAncla>(
            (
              await cuentasAbiertasPorAncla(
                tx,
                empresaId,
                ANCLA_DE_MESA,
                mesas.map((m) => m.id),
              )
            ).map((c) => [c.anclaId, c]),
          );
          const cuentaIds = [...abiertas.values()].map((c) => c.cuentaId);
          const reservas = new Map(
            (await tx.unionesYDivisiones.reservasDeUnion(empresaId, cuentaIds)).map((u) => [
              u.cuentaOrigenId,
              u,
            ]),
          );
          const madres = new Map(
            (await tx.unionesYDivisiones.divisionesPorMadres(empresaId, cuentaIds)).map((d) => [
              d.cuentaMadreId,
              d,
            ]),
          );
          const destinos = await tx.mesas.obtenerVarias(
            empresaId,
            [...reservas.values()].map((u) => u.mesaDestinoId),
          );
          const numeroDe = new Map(destinos.map((d) => [d.id, d.numero]));
          // Las cuentas hijas abiertas de cada mesa dividida.
          const hijasDe = new Map<string, { cuentaId: string; numero: number; total: string }[]>();
          for (const madre of madres.values()) {
            const hijas: { cuentaId: string; numero: number; total: string }[] = [];
            for (const parte of await tx.unionesYDivisiones.partesDeDivision(empresaId, madre.id)) {
              const c = await tx.cuentas.obtener(empresaId, parte.cuentaId as never);
              if (c !== null && c.estado === "ABIERTA") {
                hijas.push({ cuentaId: c.id, numero: parte.numero, total: c.totalProvisorio });
              }
            }
            hijasDe.set(madre.cuentaMadreId, hijas);
          }
          const aResumir = [
            ...cuentaIds.filter((id) => !reservas.has(id) && !madres.has(id)),
            ...[...hijasDe.values()].flatMap((h) => h.map((x) => x.cuentaId)),
          ];
          const resumen = await tx.envios.resumenPorCuentas(empresaId, aResumir);
          const paraElEstado = (id: string) => {
            const r = resumen.get(id);
            return {
              pendientes: (r?.paraEnviar ?? 0) + (r?.enEspera ?? 0),
              envios: r?.envios ?? 0,
            };
          };
          const filas: MesaDelMapa[] = mesas.map((mesa) => {
            const base = {
              mesaId: mesa.id,
              numero: mesa.numero,
              forma: mesa.forma,
              tamano: mesa.tamano,
              columna: mesa.columna,
              fila: mesa.fila,
            };
            const cuenta = abiertas.get(mesa.id);
            if (cuenta === undefined) {
              return { ...base, estado: estadoDeMesa({ cuentas: [], unidaAMesa: null }) };
            }
            const union = reservas.get(cuenta.cuentaId);
            if (union !== undefined) {
              const destino = numeroDe.get(union.mesaDestinoId) ?? 0;
              return {
                ...base,
                estado: estadoDeMesa({ cuentas: [], unidaAMesa: destino }),
                unidaAMesa: destino,
              };
            }
            const hijas = hijasDe.get(cuenta.cuentaId);
            if (hijas !== undefined) {
              return {
                ...base,
                estado: estadoDeMesa({
                  cuentas: hijas.map((h) => paraElEstado(h.cuentaId)),
                  unidaAMesa: null,
                }),
                cuentasHijas: hijas.map((h) => ({
                  cuentaId: h.cuentaId,
                  numero: h.numero,
                  total: importe(h.total),
                })),
                mozoId: cuenta.abiertaPor,
                minutosAbierta: Math.max(
                  0,
                  Math.floor((contexto.ahora.getTime() - cuenta.abiertaEn.getTime()) / 60000),
                ),
              };
            }
            return {
              ...base,
              estado: estadoDeMesa({ cuentas: [paraElEstado(cuenta.cuentaId)], unidaAMesa: null }),
              cuentaId: cuenta.cuentaId,
              total: importe(cuenta.totalProvisorio),
              mozoId: cuenta.abiertaPor,
              minutosAbierta: Math.max(
                0,
                Math.floor((contexto.ahora.getTime() - cuenta.abiertaEn.getTime()) / 60000),
              ),
            };
          });
          const filtro = entrada.filtro ?? "TODAS";
          const pasa = (f: MesaDelMapa) =>
            filtro === "TODAS" ||
            (filtro === "LIBRES" && f.estado === "LIBRE") ||
            (filtro === "EN_PEDIDO" && f.estado === "EN_PEDIDO") ||
            (filtro === "OCUPADAS" && f.estado === "OCUPADA");
          return ok(filas.filter(pasa));
        },
      ),

    /**
     * La ficha de una mesa: su cuenta (o las cuentas hijas de una división) con, por línea vigente, su estado de comanda (para enviar, espera o enviada
     * con su número de envío) y «De la mesa N» si el ítem vino de una unión. Los importes salen de la MISMA función pura que calcula el ticket.
     */
    fichaDeMesa: (
      contexto: ContextoOperativo,
      entrada: EntradaDeFichaDeMesa,
    ): Promise<R<FichaDeMesa>> =>
      dependencias.transacciones.ejecutar<
        FichaDeMesa,
        ErrorDeConsultaDeSalon | "MESA_NO_ENCONTRADA"
      >({ contexto, aislamiento: "read committed", soloLectura: true }, async (tx) => {
        const alcance = await previo(tx, contexto, dependencias);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.mesaId)) return err("IDENTIFICADOR_INVALIDO");
        const { empresaId } = contexto;
        const mesa = await tx.mesas.obtener(empresaId, entrada.mesaId);
        if (mesa === null) return err("MESA_NO_ENCONTRADA");
        const permitida = exigirSucursal(alcance.valor, mesa.sucursalId);
        if (!permitida.ok) return permitida;
        const abierta = await tx.cuentas.abiertaPorAncla(empresaId, {
          tipo: ANCLA_DE_MESA,
          id: mesa.id,
        });
        let unidaAMesa: number | null = null;
        let cuentasParaMostrar: { id: string; parte: number | null }[] = [];
        if (abierta !== null) {
          const union = await tx.unionesYDivisiones.unionPorOrigen(empresaId, abierta.id);
          const division = await tx.unionesYDivisiones.divisionPorMadre(empresaId, abierta.id);
          if (union !== null) {
            unidaAMesa = (await tx.mesas.obtener(empresaId, union.mesaDestinoId))?.numero ?? null;
          } else if (division !== null) {
            for (const parte of await tx.unionesYDivisiones.partesDeDivision(
              empresaId,
              division.id,
            )) {
              const hija = await tx.cuentas.obtener(empresaId, parte.cuentaId as never);
              if (hija !== null && hija.estado === "ABIERTA") {
                cuentasParaMostrar.push({ id: hija.id, parte: parte.numero });
              }
            }
          } else {
            cuentasParaMostrar = [{ id: abierta.id, parte: null }];
          }
        }
        const cuentas: CuentaDeLaFicha[] = [];
        const resumenes: number[] = [];
        for (const c of cuentasParaMostrar) {
          const lineas = await tx.cuentas.lineasDeCuenta(empresaId, c.id as never);
          const calculado = calcularLasLineas(lineas);
          const importes = new Map(
            calculado.renglones.map((r) => [r.id, importeAJson(r.importe).monto]),
          );
          const filas = new Map(
            (await tx.envios.filasDeCuenta(empresaId, c.id)).map((f) => [f.lineaId, f]),
          );
          const vigentes = lineas.filter((l) => l.estado === "VIGENTE");
          const unidas = await tx.unionesYDivisiones.lineasUnidas(
            empresaId,
            vigentes.map((l) => l.id),
          );
          const mesasDeOrigen = await tx.mesas.obtenerVarias(
            empresaId,
            [...unidas.values()].map((u) => u.mesaOrigenId),
          );
          const numeroDeOrigen = new Map(mesasDeOrigen.map((x) => [x.id, x.numero]));
          const lineasFicha: LineaDeLaFicha[] = vigentes.map((l) => {
            const f = filas.get(l.id);
            const enviada = f?.envioId !== undefined && f.envioId !== null;
            return {
              lineaId: l.id,
              posicion: l.posicion,
              descripcion: l.descripcion,
              varianteNombre: l.varianteNombre,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              importe: importes.get(l.id) ?? "0.00",
              compartida: l.importeFijo !== null,
              comanda: enviada
                ? "ENVIADA"
                : (f?.salida ?? "AHORA") === "DESPUES"
                  ? "ESPERA"
                  : "PARA_ENVIAR",
              numeroDeEnvio: f?.numeroDeEnvio ?? null,
              deLaMesa: unidas.has(l.id)
                ? (numeroDeOrigen.get(unidas.get(l.id)?.mesaOrigenId ?? "") ?? null)
                : null,
            };
          });
          resumenes.push(lineasFicha.filter((x) => x.comanda !== "ENVIADA").length);
          cuentas.push({
            cuentaId: c.id,
            parte: c.parte,
            total: importeAJson(calculado.total),
            lineas: lineasFicha,
          });
        }
        const estado = estadoDeMesa({
          cuentas: cuentas.map((c, i) => ({
            pendientes: resumenes[i] ?? 0,
            envios: c.lineas.filter((l) => l.comanda === "ENVIADA").length,
          })),
          unidaAMesa,
        });
        return ok({ mesaId: mesa.id, numero: mesa.numero, estado, unidaAMesa, cuentas });
      }),
  };
}

export type ConsultasDeSalon = ReturnType<typeof crearConsultasDeSalon>;
