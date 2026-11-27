import type { DeclaracionDeCaso } from "../capacidades/permisos/declaracion";
import { exigirAcciones } from "../capacidades/permisos/exigir";
import type { ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { ContextoOperativo } from "../contexto/contexto";
import { crearDirectorioDePartes } from "../modulos/clientes/publico";
import type { TxDeConsultasDeCompras } from "../modulos/compras/publico";
import {
  cargosAbiertos,
  creditosAbiertos,
  saldoDeParte,
  type LecturaDeSaldos,
} from "../modulos/saldos_de_partes/publico";
import { importeCero, sumar, type Importe } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { hoyEnArgentina } from "../primitivas/tiempo/fecha-civil-hasta-hoy";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia, Transacciones } from "../puertos/transacciones";

/**
 * La cuenta de un proveedor desde el libro de saldos (NOTAS-1, pedido del dueño del 26/11/2026 sobre DEC-COM-006): lo que se le DEBE, lo que queda A FAVOR de la empresa (notas de crédito o pagos que superan lo
 * pendiente: que no se olvide) y el saldo. Solo datos, sin pantalla ni texto. Lo debido es la suma de lo pendiente de sus cargos abiertos, lo a favor la suma de lo que les queda a sus saldos a favor, y el saldo
 * es el del libro: `aPagar − aFavor = saldo`, siempre (lo comprueba `test/integracion/compras-cuenta-del-proveedor.test.ts`). Lee en una transacción de solo lectura y filtra por la empresa del contexto; un
 * proveedor que no existe, que es de otra empresa o que no es proveedor sale igual (`null`). Guard `comprobantes_de_proveedor.ver` (el del resto de la lectura de facturas): no suma acciones ni decisiones nuevas.
 */
export type CuentaDelProveedor = Readonly<{
  proveedorId: string;
  /** Lo que se le debe: la suma de lo pendiente de sus cargos abiertos (nunca negativo). */
  aPagar: Importe;
  /** Lo que queda a favor de la empresa: la suma de lo que les queda por aplicar a sus saldos a favor (nunca negativo). */
  aFavor: Importe;
  /** El saldo del libro: positivo se debe, negativo es a favor, cero saldado. Siempre `aPagar − aFavor`. */
  saldo: Importe;
}>;

export type ErrorDeCuentaDelProveedor =
  MotivoDeRechazo | ErrorDePersistencia | "IDENTIFICADOR_INVALIDO";

export type DependenciasDeCuentaDelProveedor = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCompras & LecturaDeSaldos>;
  reglas: ReglasDeEmpresa;
}>;

/** La acción que la lectura exige al guard (cruce X1): la misma que ver las facturas del proveedor. */
export const DECLARACIONES_DE_CUENTA_DEL_PROVEEDOR = {
  cuentaDelProveedor: { accion: "comprobantes_de_proveedor.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const directorio = crearDirectorioDePartes();

export function crearCuentaDelProveedor(d: DependenciasDeCuentaDelProveedor) {
  return {
    cuentaDelProveedor(
      contexto: ContextoOperativo,
      entrada: Readonly<{ proveedorId: string }>,
    ): Promise<Resultado<CuentaDelProveedor | null, ErrorDeCuentaDelProveedor>> {
      if (!UUID.test(entrada.proveedorId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return d.transacciones.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx): Promise<Resultado<CuentaDelProveedor | null, ErrorDeCuentaDelProveedor>> => {
          const permiso = await exigirAcciones(d.reglas, ["comprobantes_de_proveedor.ver"], () =>
            tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          const proveedor = await directorio.parteParaOperacion(
            tx,
            contexto.empresaId,
            entrada.proveedorId,
            "PROVEEDOR",
          );
          if (!proveedor.ok) return ok(null);
          const hoy = hoyEnArgentina(contexto.ahora);
          if (!hoy.ok) throw new Error("el «hoy» de Argentina no se pudo calcular");
          const cero = importeCero(ARS);
          const cargos = await cargosAbiertos(
            tx,
            contexto,
            proveedor.valor.id,
            "A_PAGAR",
            hoy.valor,
          );
          const creditos = await creditosAbiertos(tx, contexto, proveedor.valor.id, "A_PAGAR");
          return ok({
            proveedorId: proveedor.valor.id,
            aPagar: cargos.reduce((suma, c) => sumar(suma, c.pendiente), cero),
            aFavor: creditos.reduce((suma, c) => sumar(suma, c.pendiente), cero),
            saldo: await saldoDeParte(tx, contexto, proveedor.valor.id, "A_PAGAR"),
          });
        },
      );
    },
  };
}
