import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCuentasDeConsumoParaVender } from "../../src/composicion/cuentas-de-consumo-para-vender";
import {
  listarLosClientesParaVender,
  verElClienteParaVender,
  type DependenciasDeVenderACuentaWeb,
} from "../../src/composicion/vender-a-cuenta-web";
import {
  crearCasosDeUsoDeCuentaCorriente,
  crearConsultasDeCuentaCorriente,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeCuentaCorriente,
  type TxDeEstadoDeCuenta,
} from "../../src/modulos/cuenta_corriente/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Elegir cliente al vender a cuenta (CC-5, B1a) por la composición de la web y con una base real: la lista sale sin saldos ni límites, el saldo de UN cliente sale por la mesa (cuenta abierta) o por la
 * sucursal de trabajo (venta rápida) con la previsión del servidor, y todo lo que no se puede mostrar es el genérico. Previene: un cajero que ve la cartera, una sucursal que viaja en el pedido, un saldo
 * de otra empresa o sucursal fuera del alcance, una consulta sin sucursal elegida que asume «todas» y un campo de más que se ignora en silencio.
 */
const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`se esperaba ok y vino ${JSON.stringify(r.error)}`);
  return r.dato;
};
const GENERICO = {
  ok: false,
  error: expect.objectContaining({ clave: "clientes.error.sin_permiso" }) as unknown,
};

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Tx = TxDeCuentaCorriente & TxDeConsultasDeCuentaCorriente & TxDeEstadoDeCuenta;

describe.skipIf(base === null)(
  "cuenta corriente: elegir cliente al vender a cuenta en la web (B1a)",
  () => {
    let m: MundoDeVentas;
    let e: EscenarioDeVentas;
    let otra: EscenarioDeVentas;
    let d: DependenciasDeVenderACuentaWeb;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base, { conexiones: 12, cuentaCorriente: true });
      e = await m.escenario();
      otra = await m.escenario();
      const dependencias = {
        transacciones: m.entorno as unknown as Transacciones<Tx>,
        reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      };
      const consultas = crearConsultasDeCuentaCorriente(dependencias);
      const casos = crearCasosDeUsoDeCuentaCorriente({
        ...dependencias,
        cuentasDeConsumoParaVender: crearCuentasDeConsumoParaVender(),
      });
      d = {
        consultas: () => consultas,
        casosDeUso: () => casos,
        respuesta: { registrar: () => undefined },
      };
    });
    afterAll(async () => {
      if (base !== null) await m.cerrar();
    });

    const cliente = async (
      de: EscenarioDeVentas = e,
      o: Partial<{ limite: string; suspendida: boolean }> = {},
    ): Promise<string> => {
      const id = randomUUID();
      await m.dueno.query(
        `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
        [id, de.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
      );
      await m.dueno.query(
        "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
        [de.empresa, id],
      );
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, $3, $4, $5, $6)`,
        [de.empresa, id, o.limite ?? "5000.00", claveNueva(), HUELLA, de.gerente.personaId],
      );
      if (o.suspendida === true) {
        await m.dueno.query(
          "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
          [id],
        );
      }
      return id;
    };
    const cuentaAbierta = async (de: EscenarioDeVentas = e, sucursal = de.sucursal) => {
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(de.gerente, { cuentaId: cuenta, sucursalId: sucursal }));
      return cuenta;
    };

    describe("la lista", () => {
      it("el cajero ve nombre, CUIT, plazo y estado y NADA más (ni saldo, ni límite); solo los de su empresa", async () => {
        const mio = await cliente(e);
        const suspendido = await cliente(e, { suspendida: true });
        const ajeno = await cliente(otra);
        const r = dato(await listarLosClientesParaVender(d, e.operador));
        const ids = r.clientes.map((c) => c.parteId);
        expect(ids).toEqual(expect.arrayContaining([mio, suspendido]));
        expect(ids).not.toContain(ajeno);
        expect(Object.keys(r.clientes.find((c) => c.parteId === mio) ?? {}).sort()).toEqual([
          "cuit",
          "estado",
          "nombre",
          "parteId",
          "plazoDias",
        ]);
        expect(r.clientes.find((c) => c.parteId === suspendido)?.estado).toBe("SUSPENDIDA");
      });

      it("sin persona, la lista se rechaza", async () => {
        const sinPersona = { ...e.operador, personaId: null } as unknown as typeof e.operador;
        expect(await listarLosClientesParaVender(d, sinPersona)).toMatchObject({ ok: false });
      });
    });

    describe("el saldo de un cliente elegido", () => {
      it("venta rápida: por la sucursal de trabajo que pone el servidor, con la previsión; trae SOLO lo permitido", async () => {
        const c = await cliente(e, { limite: "5000.00" });
        const r = dato(
          await verElClienteParaVender(d, e.operador, e.sucursal, {
            clienteId: c,
            totalDeLaVenta: "6000.00",
          }),
        );
        expect(Object.keys(r).sort()).toEqual([
          "cuit",
          "disponible",
          "estado",
          "excedeEn",
          "excedido",
          "nombre",
          "saldo",
          "saldoDespues",
        ]);
        expect(r).toMatchObject({
          saldo: { monto: "0.00" },
          disponible: { monto: "5000.00" },
          saldoDespues: { monto: "6000.00" },
          excedeEn: { monto: "1000.00" },
          excedido: false,
        });
        // Sin total no hay previsión.
        expect(
          dato(await verElClienteParaVender(d, e.operador, e.sucursal, { clienteId: c })),
        ).toMatchObject({
          saldoDespues: null,
          excedeEn: null,
        });
      });

      it("mesa: por la cuenta de consumo abierta, y con ella la sucursal de trabajo no cuenta", async () => {
        const c = await cliente(e);
        const cuenta = await cuentaAbierta();
        expect(
          dato(
            await verElClienteParaVender(d, e.operador, "", {
              clienteId: c,
              cuentaDeConsumoId: cuenta,
            }),
          ),
        ).toMatchObject({ estado: "HABILITADA" });
      });

      it("todo lo que no se puede mostrar es el genérico: sin sucursal elegida, sucursal de otra empresa o fuera del alcance, cuenta ajena, cliente ajeno o sin ficha, campos de más", async () => {
        const c = await cliente(e);
        const ajeno = await cliente(otra);
        const cuentaAjena = await cuentaAbierta(otra);
        const cuentaFuera = await cuentaAbierta(e, e.otraSucursal);
        const pedidos: [string, unknown][] = [
          ["", { clienteId: c }],
          [otra.sucursal, { clienteId: c }],
          [e.otraSucursal, { clienteId: c }],
          [e.sucursal, { clienteId: ajeno }],
          [e.sucursal, { clienteId: randomUUID() }],
          [e.sucursal, { clienteId: "no-es-un-id" }],
          [e.sucursal, { clienteId: c, cuentaDeConsumoId: cuentaAjena }],
          [e.sucursal, { clienteId: c, cuentaDeConsumoId: cuentaFuera }],
          [e.sucursal, { clienteId: c, sucursalId: otra.sucursal }],
          [e.sucursal, { clienteId: c, empresaId: otra.empresa }],
          [e.sucursal, { clienteId: c, totalDeLaVenta: "1e3" }],
        ];
        for (const [sucursal, pedido] of pedidos) {
          expect(
            await verElClienteParaVender(d, e.operador, sucursal, pedido),
            JSON.stringify([sucursal, pedido]),
          ).toEqual(GENERICO);
        }
      });

      it("cada consulta deja su constancia, sin importes", async () => {
        const c = await cliente(e);
        const antes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER"))
          .length;
        dato(await verElClienteParaVender(d, e.operador, e.sucursal, { clienteId: c }));
        dato(await verElClienteParaVender(d, e.operador, e.sucursal, { clienteId: c }));
        const filas = await m.auditoria(e.empresa, "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER");
        expect(filas.length).toBe(antes + 2);
        expect(JSON.stringify(filas[filas.length - 1]?.despues)).not.toMatch(/monto|5000/);
      });
    });
  },
);
