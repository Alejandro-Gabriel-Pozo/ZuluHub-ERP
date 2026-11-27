import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "../../src/composicion/apoyo-de-exportacion-de-cuenta-corriente";
import {
  fichaDeLaCuenta,
  type DependenciasDeCuentaCorrienteWeb,
} from "../../src/composicion/cuenta-corriente-web";
import {
  cambiarLasCondiciones,
  clientesParaHabilitar,
  habilitarLaCuenta,
  reactivarLaCuenta,
  suspenderLaCuenta,
  type DependenciasDeCuentaCorrienteEscrituraWeb,
} from "../../src/composicion/cuenta-corriente-escritura-web";
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
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Las escrituras de la ficha de cuenta corriente (CC-5, A2) por la composición de la web y con una base real: habilitar, cambiar plazo y límite, suspender y reactivar. Previene: una ficha duplicada
 * por un doble clic o dos pestañas, dos personas pisándose el límite (gana una), una persona sin permiso o de otra empresa que escribe, un cliente sin CUIT que se habilita, un campo de más que se
 * ignora en silencio, un error crudo del módulo en el navegador y un cambio sin su constancia (o con dos).
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

type TxDeLaCuentaCorriente = TxDeCuentaCorriente &
  TxDeConsultasDeCuentaCorriente &
  TxDeEstadoDeCuenta;

describe.skipIf(base === null)(
  "cuenta corriente: escrituras de la ficha en la web (CC-5, A2)",
  () => {
    let m: MundoDeVentas;
    let e: EscenarioDeVentas;
    let otra: EscenarioDeVentas;
    let d: DependenciasDeCuentaCorrienteEscrituraWeb;
    let lectura: DependenciasDeCuentaCorrienteWeb;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
      e = await m.escenario();
      otra = await m.escenario();
      const dependencias = {
        transacciones: m.entorno as unknown as Transacciones<TxDeLaCuentaCorriente>,
        reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      };
      const consultas = crearConsultasDeCuentaCorriente({
        ...dependencias,
        apoyo: crearApoyoDeLaExportacionDeCuentaCorriente(),
      });
      const casos = crearCasosDeUsoDeCuentaCorriente(dependencias);
      const respuesta = { registrar: () => undefined };
      d = { casosDeUso: () => casos, consultas: () => consultas, respuesta };
      lectura = { consultas: () => consultas, respuesta };
    });
    afterAll(async () => {
      if (base !== null) await m.cerrar();
    });

    const parte = async (
      de: EscenarioDeVentas,
      o: Partial<{ conCuit: boolean; conCuenta: boolean }> = {},
    ): Promise<string> => {
      const id = randomUUID();
      const conCuit = o.conCuit !== false;
      await m.dueno.query(
        `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, $4, $5, $6)`,
        [
          id,
          de.empresa,
          `Cliente ${sufijoUnico()}`,
          conCuit ? "CUIT" : null,
          conCuit ? cuitUnico() : null,
          de.gerente.personaId,
        ],
      );
      await m.dueno.query(
        "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
        [de.empresa, id],
      );
      if (o.conCuenta === true) {
        await m.dueno.query(
          `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, 30, '5000.00', $3, $4, $5)`,
          [de.empresa, id, claveNueva(), HUELLA, de.gerente.personaId],
        );
      }
      return id;
    };
    const fichas = async (parteId: string): Promise<number> =>
      Number(
        (
          await m.dueno.query<{ n: number }>(
            "select count(*)::int as n from cuenta_del_cliente where parte_id = $1",
            [parteId],
          )
        ).rows[0]?.n,
      );
    const constancias = async (accion: string): Promise<number> =>
      (await m.auditoria(e.empresa, accion)).length;
    const vigente = async (parteId: string) =>
      dato(await fichaDeLaCuenta(lectura, e.gerente, { parteId }));

    describe("habilitar", () => {
      it("habilita al cliente con su plazo y su límite y deja la constancia; la ficha ya sale con su id y su versión", async () => {
        const p = await parte(e);
        const antes = await constancias("CUENTA_DEL_CLIENTE_HABILITADA");
        const r = await habilitarLaCuenta(d, e.gerente, {
          id: randomUUID(),
          parteId: p,
          plazoDias: 45,
          limite: "120000.50",
        });
        expect(dato(r)).toEqual({ parteId: p });
        const f = await vigente(p);
        expect(f).toMatchObject({
          plazoDias: 45,
          estado: "HABILITADA",
          limite: { monto: "120000.50" },
        });
        expect(f.cuentaId).toMatch(/^[0-9a-f-]{36}$/);
        expect(f.version).toBeGreaterThanOrEqual(1);
        expect(await constancias("CUENTA_DEL_CLIENTE_HABILITADA")).toBe(antes + 1);
      });

      it("repetir el mismo pedido (doble clic, reintento) no duplica la ficha ni la constancia; dos a la vez, tampoco", async () => {
        const p = await parte(e);
        const pedido = { id: randomUUID(), parteId: p, plazoDias: 30, limite: "1000.00" };
        const antes = await constancias("CUENTA_DEL_CLIENTE_HABILITADA");
        const [a, b] = await Promise.all([
          habilitarLaCuenta(d, e.gerente, pedido),
          habilitarLaCuenta(d, e.gerente, pedido),
        ]);
        const c = await habilitarLaCuenta(d, e.gerente, pedido);
        expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
        expect(await fichas(p)).toBe(1);
        expect(await constancias("CUENTA_DEL_CLIENTE_HABILITADA")).toBe(antes + 1);
      });

      it("el cliente que ya tiene cuenta, el que no tiene CUIT y la misma clave con otro contenido salen como el genérico, sin escribir", async () => {
        const yaTiene = await parte(e, { conCuenta: true });
        const sinCuit = await parte(e, { conCuit: false });
        const libre = await parte(e);
        const clave = randomUUID();
        dato(
          await habilitarLaCuenta(d, e.gerente, {
            id: clave,
            parteId: libre,
            plazoDias: 30,
            limite: "1000.00",
          }),
        );
        expect(
          await habilitarLaCuenta(d, e.gerente, {
            id: randomUUID(),
            parteId: yaTiene,
            plazoDias: 30,
            limite: "1.00",
          }),
        ).toEqual(GENERICO);
        expect(
          await habilitarLaCuenta(d, e.gerente, {
            id: randomUUID(),
            parteId: sinCuit,
            plazoDias: 30,
            limite: "1.00",
          }),
        ).toEqual(GENERICO);
        expect(
          await habilitarLaCuenta(d, e.gerente, {
            id: clave,
            parteId: libre,
            plazoDias: 30,
            limite: "2000.00",
          }),
        ).toEqual(GENERICO);
        expect(await fichas(sinCuit)).toBe(0);
        expect(await fichas(yaTiene)).toBe(1);
      });

      it("plazo o límite inválidos y campos de más son el genérico y no escriben", async () => {
        const p = await parte(e);
        const base = { id: randomUUID(), parteId: p, plazoDias: 30, limite: "1000.00" };
        for (const malo of [
          { ...base, plazoDias: 0 },
          { ...base, plazoDias: 366 },
          { ...base, limite: "1e3" },
          { ...base, limite: "-5.00" },
          { ...base, limite: "10.005" },
          { ...base, empresaId: otra.empresa },
          { ...base, parteId: "no-es-un-id" },
        ]) {
          expect(await habilitarLaCuenta(d, e.gerente, malo), JSON.stringify(malo)).toEqual(
            GENERICO,
          );
        }
        expect(await fichas(p)).toBe(0);
      });

      it("quien no tiene `administrar` (un cajero) y otra empresa no escriben", async () => {
        const p = await parte(e);
        const pedido = { id: randomUUID(), parteId: p, plazoDias: 30, limite: "1000.00" };
        expect((await habilitarLaCuenta(d, e.operador, pedido)).ok).toBe(false);
        expect(await habilitarLaCuenta(d, otra.gerente, pedido)).toEqual(GENERICO);
        expect(await fichas(p)).toBe(0);
      });
    });

    describe("la lista de clientes para habilitar", () => {
      it("trae a los que no tienen cuenta, también sin CUIT, y no a los que sí; un cajero no la ve", async () => {
        const libre = await parte(e);
        const sinCuit = await parte(e, { conCuit: false });
        const conCuenta = await parte(e, { conCuenta: true });
        const ids = dato(await clientesParaHabilitar(d, e.gerente)).clientes.map((c) => c.parteId);
        expect(ids).toEqual(expect.arrayContaining([libre, sinCuit]));
        expect(ids).not.toContain(conCuenta);
        expect((await clientesParaHabilitar(d, e.operador)).ok).toBe(false);
      });
    });

    describe("cambiar plazo y límite", () => {
      it("cambia con la versión que se vio, deja una constancia y repetirlo no escribe de nuevo", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        const antes = await constancias("CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS");
        const pedido = {
          cuentaId: f.cuentaId,
          versionEsperada: f.version,
          plazoDias: 60,
          limite: "9000.00",
        };
        expect(dato(await cambiarLasCondiciones(d, e.gerente, pedido))).toEqual({
          parteId: p,
          sinCambios: false,
        });
        expect(dato(await cambiarLasCondiciones(d, e.gerente, pedido)).sinCambios).toBe(true);
        expect(await constancias("CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS")).toBe(antes + 1);
        expect(await vigente(p)).toMatchObject({ plazoDias: 60, limite: { monto: "9000.00" } });
      });

      it("con una versión vieja se rechaza (genérico) y no pisa lo de la otra persona", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        dato(
          await cambiarLasCondiciones(d, e.gerente, {
            cuentaId: f.cuentaId,
            versionEsperada: f.version,
            plazoDias: 40,
            limite: "7000.00",
          }),
        );
        expect(
          await cambiarLasCondiciones(d, e.gerente, {
            cuentaId: f.cuentaId,
            versionEsperada: f.version,
            plazoDias: 50,
            limite: "8000.00",
          }),
        ).toEqual(GENERICO);
        expect(await vigente(p)).toMatchObject({ plazoDias: 40, limite: { monto: "7000.00" } });
      });

      it("dos cambios a la vez con la misma versión: gana uno y el otro se rechaza", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        const antes = await constancias("CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS");
        const en = (plazoDias: number, limite: string) =>
          cambiarLasCondiciones(d, e.gerente, {
            cuentaId: f.cuentaId,
            versionEsperada: f.version,
            plazoDias,
            limite,
          });
        const rs = await Promise.all([en(10, "100.00"), en(20, "200.00")]);
        expect(rs.filter((r) => r.ok)).toHaveLength(1);
        expect(rs.filter((r) => !r.ok)).toEqual([GENERICO]);
        expect(await constancias("CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS")).toBe(antes + 1);
      });

      it("sin permiso o desde otra empresa no cambia nada", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        const pedido = {
          cuentaId: f.cuentaId,
          versionEsperada: f.version,
          plazoDias: 99,
          limite: "1.00",
        };
        expect((await cambiarLasCondiciones(d, e.operador, pedido)).ok).toBe(false);
        expect(await cambiarLasCondiciones(d, otra.gerente, pedido)).toEqual(GENERICO);
        expect(await vigente(p)).toMatchObject({ plazoDias: 30, version: f.version });
      });
    });

    describe("suspender y reactivar", () => {
      it("suspende con motivo y reactiva, cada uno con su constancia; repetir lo ya hecho no escribe", async () => {
        const p = await parte(e, { conCuenta: true });
        let f = await vigente(p);
        const susp = await constancias("CUENTA_DEL_CLIENTE_SUSPENDIDA");
        const reac = await constancias("CUENTA_DEL_CLIENTE_REACTIVADA");
        expect(
          dato(
            await suspenderLaCuenta(d, e.gerente, {
              cuentaId: f.cuentaId,
              versionEsperada: f.version,
              motivo: "Pago atrasado",
            }),
          ),
        ).toEqual({ parteId: p, yaEstaba: false });
        expect(
          dato(
            await suspenderLaCuenta(d, e.gerente, {
              cuentaId: f.cuentaId,
              versionEsperada: f.version,
              motivo: "Pago atrasado",
            }),
          ).yaEstaba,
        ).toBe(true);
        f = await vigente(p);
        expect(f).toMatchObject({ estado: "SUSPENDIDA", motivoDeSuspension: "Pago atrasado" });
        expect(await constancias("CUENTA_DEL_CLIENTE_SUSPENDIDA")).toBe(susp + 1);

        expect(
          dato(
            await reactivarLaCuenta(d, e.gerente, {
              cuentaId: f.cuentaId,
              versionEsperada: f.version,
              motivo: "Regularizó sus pagos",
            }),
          ),
        ).toEqual({ parteId: p, yaEstaba: false });
        expect(
          dato(
            await reactivarLaCuenta(d, e.gerente, {
              cuentaId: f.cuentaId,
              versionEsperada: f.version,
              motivo: "Regularizó sus pagos",
            }),
          ).yaEstaba,
        ).toBe(true);
        expect(await vigente(p)).toMatchObject({ estado: "HABILITADA", motivoDeSuspension: null });
        expect(await constancias("CUENTA_DEL_CLIENTE_REACTIVADA")).toBe(reac + 1);
      });

      it("suspender sin motivo, con uno enorme o con un campo de más es el genérico y no cambia nada", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        for (const motivo of ["", "   ", "x".repeat(2000)]) {
          expect(
            await suspenderLaCuenta(d, e.gerente, {
              cuentaId: f.cuentaId,
              versionEsperada: f.version,
              motivo,
            }),
          ).toEqual(GENERICO);
        }
        expect(
          await suspenderLaCuenta(d, e.gerente, {
            cuentaId: f.cuentaId,
            versionEsperada: f.version,
            motivo: "ok",
            estado: "SUSPENDIDA",
          }),
        ).toEqual(GENERICO);
        expect((await vigente(p)).estado).toBe("HABILITADA");
      });

      it("dos suspensiones a la vez con la misma versión dejan UNA constancia", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        const antes = await constancias("CUENTA_DEL_CLIENTE_SUSPENDIDA");
        const rs = await Promise.all(
          ["a", "b"].map((motivo) =>
            suspenderLaCuenta(d, e.gerente, {
              cuentaId: f.cuentaId,
              versionEsperada: f.version,
              motivo,
            }),
          ),
        );
        expect(rs.some((r) => r.ok)).toBe(true);
        expect((await vigente(p)).estado).toBe("SUSPENDIDA");
        expect(await constancias("CUENTA_DEL_CLIENTE_SUSPENDIDA")).toBe(antes + 1);
      });

      it("sin permiso, con una versión vieja o desde otra empresa no cambia el estado", async () => {
        const p = await parte(e, { conCuenta: true });
        const f = await vigente(p);
        const pedido = { cuentaId: f.cuentaId, versionEsperada: f.version, motivo: "x" };
        expect((await suspenderLaCuenta(d, e.operador, pedido)).ok).toBe(false);
        expect(await suspenderLaCuenta(d, otra.gerente, pedido)).toEqual(GENERICO);
        expect(
          await suspenderLaCuenta(d, e.gerente, { ...pedido, versionEsperada: f.version + 5 }),
        ).toEqual(GENERICO);
        expect((await vigente(p)).estado).toBe("HABILITADA");
      });
    });
  },
);
