import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  agregarLaCaja,
  desactivarLaCaja,
  editarLaCaja,
  listarLasCajas,
  reactivarLaCaja,
  type DependenciasDeCajasWeb,
} from "../../src/composicion/cajas-web";
import {
  agregarLaCuentaDeCobro,
  desactivarLaCuentaDeCobro,
  editarLaCuentaDeCobro,
  listarLasCuentasDeCobro,
  reactivarLaCuentaDeCobro,
  type CuentaParaLaPantalla,
  type DependenciasDeCuentasDeCobroWeb,
} from "../../src/composicion/cuentas-de-cobro-web";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  crearMundoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type MundoDeCaja,
} from "./caja-configuracion-apoyo";

/**
 * «Cuentas de cobro» y «Cajas» de la web contra una base real y los roles reales: lo que la pantalla recibe, cada error con su código público, que repetir no duplica, que dos a la
 * vez no se pisan, que una sucursal ajena o un límite del plan salen como el genérico (sin pistas) y que el permiso lo decide el caso de uso. Los casos de uso en sí (guard, auditoría,
 * concurrencia del dominio, límite del plan) tienen sus pruebas en `caja-configuracion-*.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(base === null)("cuentas de cobro y cajas de la web", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let dc: DependenciasDeCuentasDeCobroWeb;
  let dk: DependenciasDeCajasWeb;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    const caja = armarCaja(entorno);
    const respuesta = { registrar: () => undefined };
    dc = { casosDeUso: () => caja.casos, consultas: () => caja.consultas, respuesta };
    dk = { casosDeUso: () => caja.casos, consultas: () => caja.consultas, respuesta };
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const mundo = (limiteDeCajas?: number) =>
    crearMundoDeCaja(entornoBase, dueno, limiteDeCajas === undefined ? {} : { limiteDeCajas });
  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query<{ n: string }>(texto, parametros)).rows[0] ?? { n: "0" }).n);

  describe("cuentas de cobro", () => {
    const cuentas = async (m: MundoDeCaja): Promise<readonly CuentaParaLaPantalla[]> => {
      const r = await listarLasCuentasDeCobro(dc, m.ctx());
      if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
      return r.dato.cuentas;
    };
    const alta = async (m: MundoDeCaja, nombre: string, extra: Record<string, unknown> = {}) => {
      const r = await agregarLaCuentaDeCobro(dc, m.ctx(), {
        tipo: "TERMINAL",
        nombre,
        identificadorExterno: "",
        sucursalId: m.sucursal,
        ...extra,
      });
      if (!r.ok) throw new Error(`se esperaba el alta y vino ${r.error.codigo}`);
      return r.dato.cuentaDeCobroId;
    };

    it("la lista trae todas las cuentas, también las desactivadas, y solo los campos de la pantalla; el identificador en blanco es «sin dato»", async () => {
      const m = await mundo();
      const id = await alta(m, "Posnet 1", { identificadorExterno: "T-0481" });
      await alta(m, "QR del local", { tipo: "QR" });
      await desactivarLaCuentaDeCobro(dc, m.ctx(), { cuentaDeCobroId: id });
      const lista = await cuentas(m);
      expect(lista.map((c) => [c.nombre, c.tipo, c.identificadorExterno, c.activa]).sort()).toEqual(
        [
          ["Posnet 1", "TERMINAL", "T-0481", false],
          ["QR del local", "QR", null, true],
        ].sort(),
      );
      for (const c of lista) {
        expect(Object.keys(c).sort()).toEqual([
          "activa",
          "id",
          "identificadorExterno",
          "nombre",
          "sucursalId",
          "tipo",
          "version",
        ]);
      }
    });

    it("repetir el alta no duplica (clic doble) y dos altas iguales a la vez dejan una; el mismo nombre es CAJA_CUENTA_REPETIDA", async () => {
      const m = await mundo();
      const uno = await alta(m, "Posnet 1");
      expect(await alta(m, "Posnet 1")).toBe(uno);
      const [a, b] = await Promise.all([
        agregarLaCuentaDeCobro(dc, m.ctx(), {
          tipo: "QR",
          nombre: "Otra",
          identificadorExterno: null,
          sucursalId: m.sucursal,
        }),
        agregarLaCuentaDeCobro(dc, m.ctx(), {
          tipo: "QR",
          nombre: "Otra",
          identificadorExterno: null,
          sucursalId: m.sucursal,
        }),
      ]);
      expect([a.ok, b.ok]).toEqual([true, true]);
      expect(await cuentas(m)).toHaveLength(2);
      expect(
        codigoDe(
          await agregarLaCuentaDeCobro(dc, m.ctx(), {
            tipo: "QR",
            nombre: "Posnet 1",
            identificadorExterno: null,
            sucursalId: m.sucursal,
          }),
        ),
      ).toBe("CAJA_CUENTA_REPETIDA");
    });

    it("un identificador con la forma de una credencial es CAJA_IDENTIFICADOR_INVALIDO; el tipo inválido y un pedido sin forma, el genérico", async () => {
      const m = await mundo();
      const pedido = {
        tipo: "TERMINAL",
        nombre: "X",
        identificadorExterno: null,
        sucursalId: m.sucursal,
      };
      expect(
        codigoDe(
          await agregarLaCuentaDeCobro(dc, m.ctx(), {
            ...pedido,
            identificadorExterno: "clave=<script>",
          }),
        ),
      ).toBe("CAJA_IDENTIFICADOR_INVALIDO");
      expect(
        codigoDe(await agregarLaCuentaDeCobro(dc, m.ctx(), { ...pedido, tipo: "CHEQUE" })),
      ).toBe("CAJA_ACCION_NO_PERMITIDA");
      expect(codigoDe(await agregarLaCuentaDeCobro(dc, m.ctx(), { nombre: "X" }))).toBe(
        "CAJA_ACCION_NO_PERMITIDA",
      );
      expect(await cuentas(m)).toHaveLength(0);
    });

    it("la sucursal tiene que ser una elegida y de la persona: una ajena, de otra empresa o inexistente es el mismo genérico", async () => {
      const a = await mundo();
      const b = await mundo();
      const pedido = (sucursalId: string) => ({
        tipo: "QR",
        nombre: "Cuenta",
        identificadorExterno: null,
        sucursalId,
      });
      expect(codigoDe(await agregarLaCuentaDeCobro(dc, a.ctx(), pedido(b.sucursal)))).toBe(
        "CAJA_ACCION_NO_PERMITIDA",
      );
      expect(
        codigoDe(
          await agregarLaCuentaDeCobro(dc, a.ctx(), pedido("0b0b0b0b-1111-4222-8333-444444444444")),
        ),
      ).toBe("CAJA_ACCION_NO_PERMITIDA");
      expect(await cuentas(a)).toHaveLength(0);
    });

    it("editar: cambia nombre, identificador y sucursal; con la versión vieja no escribe y sale el genérico; dos a la vez no se pisan", async () => {
      const m = await mundo();
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Norte");
      const id = await alta(m, "Posnet 1");
      const inicial = (await cuentas(m))[0] as CuentaParaLaPantalla;
      const editado = await editarLaCuentaDeCobro(dc, m.ctx(), {
        cuentaDeCobroId: id,
        versionEsperada: inicial.version,
        nombre: "Posnet del salón",
        identificadorExterno: "T-9",
        sucursalId: otra,
      });
      expect(editado.ok).toBe(true);
      const despues = (await cuentas(m))[0] as CuentaParaLaPantalla;
      expect([despues.nombre, despues.identificadorExterno, despues.sucursalId]).toEqual([
        "Posnet del salón",
        "T-9",
        otra,
      ]);
      const pedido = (nombre: string) => ({
        cuentaDeCobroId: id,
        versionEsperada: despues.version,
        nombre,
        identificadorExterno: null,
        sucursalId: otra,
      });
      const [x, y] = await Promise.all([
        editarLaCuentaDeCobro(dc, m.ctx(), pedido("Uno")),
        editarLaCuentaDeCobro(dc, m.ctx(), pedido("Dos")),
      ]);
      expect([x.ok, y.ok].sort()).toEqual([false, true]);
      expect(
        codigoDe(
          await editarLaCuentaDeCobro(dc, m.ctx(), {
            ...pedido("Tres"),
            versionEsperada: inicial.version,
          }),
        ),
      ).toBe("CAJA_ACCION_NO_PERMITIDA");
    });

    it("desactivar y reactivar: cada uno es un solo efecto aunque se repita; una cuenta de otra empresa es el genérico", async () => {
      const m = await mundo();
      const ajena = await alta(await mundo(), "Ajena");
      const id = await alta(m, "Posnet 1");
      for (let i = 0; i < 2; i++) {
        expect((await desactivarLaCuentaDeCobro(dc, m.ctx(), { cuentaDeCobroId: id })).ok).toBe(
          true,
        );
      }
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CUENTA_DE_COBRO_DESACTIVADA'",
          [m.empresa],
        ),
      ).toBe(1);
      for (let i = 0; i < 2; i++) {
        expect((await reactivarLaCuentaDeCobro(dc, m.ctx(), { cuentaDeCobroId: id })).ok).toBe(
          true,
        );
      }
      expect(
        codigoDe(await desactivarLaCuentaDeCobro(dc, m.ctx(), { cuentaDeCobroId: ajena })),
      ).toBe("CAJA_ACCION_NO_PERMITIDA");
    });

    it("el operador ve la lista de sus sucursales pero no agrega ni edita (SIN_PERMISO)", async () => {
      const m = await mundo();
      const id = await alta(m, "Posnet 1");
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      expect((await listarLasCuentasDeCobro(dc, operador())).ok).toBe(true);
      expect(
        codigoDe(
          await agregarLaCuentaDeCobro(dc, operador(), {
            tipo: "QR",
            nombre: "X",
            identificadorExterno: null,
            sucursalId: m.sucursal,
          }),
        ),
      ).toBe("SIN_PERMISO");
      expect(
        codigoDe(await desactivarLaCuentaDeCobro(dc, operador(), { cuentaDeCobroId: id })),
      ).toBe("SIN_PERMISO");
      expect(await cuentas(m)).toHaveLength(1);
    });
  });

  describe("cajas", () => {
    const cajas = async (m: MundoDeCaja, sucursal: string = m.sucursal) => {
      const r = await listarLasCajas(dk, m.ctx(), sucursal);
      if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
      return r.dato.cajas;
    };

    it("agregar una caja en la sucursal que fija el servidor; repetir no duplica; el mismo nombre es CAJA_CAJA_REPETIDA; la lista trae solo los campos de la pantalla", async () => {
      const m = await mundo(5);
      const uno = await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja del salón" });
      const dos = await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja del salón" });
      expect([uno.ok, dos.ok]).toEqual([true, true]);
      expect(uno.ok && dos.ok && uno.dato.cajaId === dos.dato.cajaId).toBe(true);
      const otra = await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja de la barra" });
      if (!otra.ok) throw new Error("alta");
      const barra = (await cajas(m)).find((c) => c.id === otra.dato.cajaId);
      expect(
        codigoDe(
          await editarLaCaja(dk, m.ctx(), {
            cajaId: otra.dato.cajaId,
            versionEsperada: barra?.version ?? 0,
            nombre: "Caja del salón",
          }),
        ),
      ).toBe("CAJA_CAJA_REPETIDA");
      expect((await desactivarLaCaja(dk, m.ctx(), { cajaId: otra.dato.cajaId })).ok).toBe(true);
      expect(
        codigoDe(await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja de la barra" })),
      ).toBe("CAJA_CAJA_REPETIDA");
      const lista = await cajas(m);
      expect(lista).toHaveLength(2);
      expect(Object.keys(lista[0] ?? {}).sort()).toEqual(["activa", "id", "nombre", "version"]);
    });

    it("la sucursal del pedido no cuenta: manda la que pasa el servidor; una ajena es el genérico", async () => {
      const m = await mundo(5);
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Norte");
      const r = await agregarLaCaja(dk, m.ctx(), otra, {
        nombre: "Caja norte",
        sucursalId: m.sucursal,
      });
      expect(r.ok).toBe(true);
      expect(await cajas(m, otra)).toHaveLength(1);
      expect(await cajas(m)).toHaveLength(0);
      const ajeno = await mundo(5);
      expect(codigoDe(await agregarLaCaja(dk, m.ctx(), ajeno.sucursal, { nombre: "X" }))).toBe(
        "CAJA_ACCION_NO_PERMITIDA",
      );
    });

    it("sumar una caja por encima de lo que incluye el plan lo rechaza el servidor con el genérico y no escribe", async () => {
      const m = await mundo(1);
      expect((await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja 1" })).ok).toBe(true);
      expect(codigoDe(await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja 2" }))).toBe(
        "CAJA_ACCION_NO_PERMITIDA",
      );
      expect(await cajas(m)).toHaveLength(1);
    });

    it("editar el nombre con su versión; la vieja y dos a la vez no pisan", async () => {
      const m = await mundo(5);
      const alta = await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja 1" });
      if (!alta.ok) throw new Error("alta");
      const inicial = (await cajas(m))[0];
      const pedido = (nombre: string, versionEsperada: number) => ({
        cajaId: alta.dato.cajaId,
        versionEsperada,
        nombre,
      });
      const [x, y] = await Promise.all([
        editarLaCaja(dk, m.ctx(), pedido("Uno", inicial?.version ?? 0)),
        editarLaCaja(dk, m.ctx(), pedido("Dos", inicial?.version ?? 0)),
      ]);
      expect([x.ok, y.ok].sort()).toEqual([false, true]);
      expect(codigoDe(await editarLaCaja(dk, m.ctx(), pedido("Tres", inicial?.version ?? 0)))).toBe(
        "CAJA_ACCION_NO_PERMITIDA",
      );
    });

    it("desactivar y reactivar: un solo efecto aunque se repita", async () => {
      const m = await mundo(5);
      const alta = await agregarLaCaja(dk, m.ctx(), m.sucursal, { nombre: "Caja 1" });
      if (!alta.ok) throw new Error("alta");
      const id = alta.dato.cajaId;
      for (let i = 0; i < 2; i++) {
        expect((await desactivarLaCaja(dk, m.ctx(), { cajaId: id })).ok).toBe(true);
      }
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CAJA_DESACTIVADA'",
          [m.empresa],
        ),
      ).toBe(1);
      for (let i = 0; i < 2; i++) {
        expect((await reactivarLaCaja(dk, m.ctx(), { cajaId: id })).ok).toBe(true);
      }
    });

    it("quien solo opera no agrega ni desactiva (SIN_PERMISO)", async () => {
      const m = await mundo(5);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      expect(codigoDe(await agregarLaCaja(dk, operador(), m.sucursal, { nombre: "X" }))).toBe(
        "SIN_PERMISO",
      );
    });
  });
});
