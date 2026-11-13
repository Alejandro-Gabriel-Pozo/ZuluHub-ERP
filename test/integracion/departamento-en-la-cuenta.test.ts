import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarVentas, nuevoId, valorDe, type MundoDeVentas } from "./ventas-apoyo";

/**
 * A2c (a): la cuenta de venta guarda el departamento con el que se abrió (migración 0048; decisión del dueño del 13/11/2026: se pega a la CUENTA, no a la caja). Lo que se
 * prueba: sin departamentos la cuenta queda sin departamento; con uno solo activo lo toma; con dos o más se exige elegir (nunca «todos»); el elegido tiene que existir, ser de la
 * empresa, ser de primer nivel y estar activo; repetir la apertura devuelve la misma cuenta (idempotencia) y con otro departamento es `CUENTA_ID_EN_USO`; dos aperturas a la
 * vez dejan UNA cuenta; la base impone las mismas reglas y que el departamento no cambie; y la reversión.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("departamento en la cuenta (0048)", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** Un nodo de la clasificación (armado por el dueño de la base: lo que se prueba es la cuenta, no el árbol). */
  const nodo = async (empresa: string, nombre: string, padre: string | null = null) => {
    const id = randomUUID();
    await m.dueno.query(
      "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, $3, $4, lower($4))",
      [id, empresa, padre, nombre],
    );
    return id;
  };
  const desactivar = (id: string) =>
    m.dueno.query("update nodo_de_clasificacion set activo = false where id = $1", [id]);
  const departamentoGuardado = async (cuenta: string) =>
    (
      await m.filas<{ d: string | null }>(
        "select departamento_id as d from cuenta_consumo where id = $1",
        [cuenta],
      )
    )[0]?.d;

  it("sin departamentos en la empresa: la cuenta queda sin departamento", async () => {
    const e = await m.escenario();
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    expect(await departamentoGuardado(cuenta)).toBeNull();
  });

  it("con un solo departamento activo: lo toma sin que se lo manden, y la auditoría lo deja escrito", async () => {
    const e = await m.escenario();
    const dep = await nodo(e.empresa, "Restaurante");
    // una categoría y un departamento desactivado no cuentan
    await nodo(e.empresa, "Bebidas", dep);
    await desactivar(await nodo(e.empresa, "Viejo"));
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    expect(await departamentoGuardado(cuenta)).toBe(dep);
    const auditoria = await m.filas<{ despues: { departamentoId: string } }>(
      "select despues from auditoria_empresa where empresa_id = $1 and accion = 'CUENTA_ABIERTA' and entidad_id = $2",
      [e.empresa, cuenta],
    );
    expect(auditoria[0]?.despues.departamentoId).toBe(dep);
  });

  it("con dos o más activos: sin elegir se rechaza y no escribe nada; eligiendo uno válido se guarda", async () => {
    const e = await m.escenario();
    const a = await nodo(e.empresa, "Hotel");
    const b = await nodo(e.empresa, "Spa");
    const sinElegir = nuevoId();
    expect(
      await m.casos.abrirCuenta(e.gerente, { cuentaId: sinElegir, sucursalId: e.sucursal }),
    ).toEqual({ ok: false, error: "DEPARTAMENTO_REQUERIDO" });
    expect(await m.filas("select 1 from cuenta_consumo where id = $1", [sinElegir])).toHaveLength(
      0,
    );
    const elegida = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: elegida,
        sucursalId: e.sucursal,
        departamentoId: b,
      }),
    );
    expect(await departamentoGuardado(elegida)).toBe(b);
    // elegir otro no toca la cuenta ya abierta de a
    const otra = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: otra,
        sucursalId: e.sucursal,
        departamentoId: a,
      }),
    );
    expect(await departamentoGuardado(otra)).toBe(a);
  });

  it("el departamento elegido tiene que existir, ser de la empresa, ser de primer nivel y estar activo", async () => {
    const e = await m.escenario();
    const otraEmpresa = await m.escenario();
    const dep = await nodo(e.empresa, "Hotel");
    await nodo(e.empresa, "Spa");
    const categoria = await nodo(e.empresa, "Habitaciones", dep);
    const inactivo = await nodo(e.empresa, "Cerrado");
    await desactivar(inactivo);
    const ajeno = await nodo(otraEmpresa.empresa, "Ajeno");
    const abrir = (departamentoId: string) =>
      m.casos.abrirCuenta(e.gerente, {
        cuentaId: nuevoId(),
        sucursalId: e.sucursal,
        departamentoId,
      });
    expect(await abrir(randomUUID())).toEqual({ ok: false, error: "DEPARTAMENTO_NO_ENCONTRADO" });
    expect(await abrir(categoria)).toEqual({ ok: false, error: "DEPARTAMENTO_NO_ENCONTRADO" });
    // el de otra empresa no existe para esta (la RLS filtra y el filtro por empresa lo repite)
    expect(await abrir(ajeno)).toEqual({ ok: false, error: "DEPARTAMENTO_NO_ENCONTRADO" });
    expect(await abrir(inactivo)).toEqual({ ok: false, error: "DEPARTAMENTO_INACTIVO" });
  });

  it("idempotencia: repetir lo mismo devuelve la misma cuenta; sin nombrar el departamento también; con otro es CUENTA_ID_EN_USO", async () => {
    const e = await m.escenario();
    const a = await nodo(e.empresa, "Hotel");
    const b = await nodo(e.empresa, "Spa");
    const cuenta = nuevoId();
    const entrada = { cuentaId: cuenta, sucursalId: e.sucursal, departamentoId: a };
    expect(valorDe(await m.casos.abrirCuenta(e.gerente, entrada)).yaExistia).toBe(false);
    expect(valorDe(await m.casos.abrirCuenta(e.gerente, entrada)).yaExistia).toBe(true);
    // un reintento que no manda el departamento acepta el que quedó guardado
    expect(
      valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }))
        .yaExistia,
    ).toBe(true);
    expect(await m.casos.abrirCuenta(e.gerente, { ...entrada, departamentoId: b })).toEqual({
      ok: false,
      error: "CUENTA_ID_EN_USO",
    });
    expect(await departamentoGuardado(cuenta)).toBe(a);
    expect(await m.filas("select 1 from cuenta_consumo where id = $1", [cuenta])).toHaveLength(1);
  });

  it("dos aperturas simultáneas de la misma cuenta: queda UNA fila con el departamento pedido", async () => {
    const e = await m.escenario();
    const dep = await nodo(e.empresa, "Hotel");
    await nodo(e.empresa, "Spa");
    for (let i = 0; i < 6; i++) {
      const cuenta = nuevoId();
      const entrada = { cuentaId: cuenta, sucursalId: e.sucursal, departamentoId: dep };
      const [x, y] = await Promise.all([
        m.casos.abrirCuenta(e.gerente, entrada),
        m.casos.abrirCuenta(e.gerente, entrada),
      ]);
      expect(x.ok && y.ok).toBe(true);
      expect(
        [x, y].filter((r) => r.ok && !r.valor.yaExistia),
        "exactamente una creó",
      ).toHaveLength(1);
      expect(await departamentoGuardado(cuenta)).toBe(dep);
    }
  });

  it("desactivar el departamento después no cambia la cuenta ya abierta; abrir otra ahí se rechaza", async () => {
    const e = await m.escenario();
    const dep = await nodo(e.empresa, "Hotel");
    await nodo(e.empresa, "Spa");
    const cuenta = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: cuenta,
        sucursalId: e.sucursal,
        departamentoId: dep,
      }),
    );
    await desactivar(dep);
    expect(await departamentoGuardado(cuenta)).toBe(dep);
    expect(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: nuevoId(),
        sucursalId: e.sucursal,
        departamentoId: dep,
      }),
    ).toEqual({ ok: false, error: "DEPARTAMENTO_INACTIVO" });
  });

  describe("la base impone las mismas reglas", () => {
    it("un nodo que no es de primer nivel, uno desactivado, uno de otra empresa o inexistente se rechazan", async () => {
      const e = await m.escenario();
      const otra = await m.escenario();
      const persona = e.gerente.personaId;
      const dep = await nodo(e.empresa, "Hotel");
      const categoria = await nodo(e.empresa, "Habitaciones", dep);
      const inactivo = await nodo(e.empresa, "Cerrado");
      await desactivar(inactivo);
      const ajeno = await nodo(otra.empresa, "Ajeno");
      const directo = async (departamento: string) => {
        try {
          await m.dueno.query(
            "insert into cuenta_consumo (id, empresa_id, sucursal_id, departamento_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5, now())",
            [nuevoId(), e.empresa, e.sucursal, departamento, persona],
          );
          return "sin error";
        } catch (error) {
          return (error as { constraint?: string }).constraint ?? "otro error";
        }
      };
      expect(await directo(categoria)).toBe("cuenta_departamento_no_es_departamento");
      expect(await directo(inactivo)).toBe("cuenta_departamento_inactivo");
      // El disparador corre antes que la clave foránea: uno de otra empresa o inexistente «no es un departamento» de esta.
      expect(await directo(ajeno)).toBe("cuenta_departamento_no_es_departamento");
      expect(await directo(randomUUID())).toBe("cuenta_departamento_no_es_departamento");
      expect(await directo(dep)).toBe("sin error");
    });

    it("el departamento de una cuenta no cambia nunca (ni siquiera el dueño de la base): ni a otro, ni a nulo", async () => {
      const e = await m.escenario();
      const a = await nodo(e.empresa, "Hotel");
      const b = await nodo(e.empresa, "Spa");
      const cuenta = nuevoId();
      valorDe(
        await m.casos.abrirCuenta(e.gerente, {
          cuentaId: cuenta,
          sucursalId: e.sucursal,
          departamentoId: a,
        }),
      );
      for (const nuevo of [b, null]) {
        let constraint: string | undefined;
        try {
          await m.dueno.query("update cuenta_consumo set departamento_id = $2 where id = $1", [
            cuenta,
            nuevo,
          ]);
        } catch (error) {
          constraint = (error as { constraint?: string }).constraint;
        }
        expect(constraint).toBe("cuenta_departamento_inmutable");
      }
      expect(await departamentoGuardado(cuenta)).toBe(a);
    });
  });

  describe("reversión", () => {
    it("frena si hay cuentas con departamento (sin confirmación); con ella deja la tabla como antes y se puede repetir", async () => {
      if (base === null) return;
      const m2 = await montarVentas(base);
      try {
        const e2 = await m2.escenario();
        const dep = randomUUID();
        await m2.dueno.query(
          "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, null, 'Hotel', 'hotel')",
          [dep, e2.empresa],
        );
        valorDe(
          await m2.casos.abrirCuenta(e2.gerente, {
            cuentaId: nuevoId(),
            sucursalId: e2.sucursal,
            departamentoId: dep,
          }),
        );
        const sql = await readFile(
          join(
            import.meta.dirname,
            "../../migraciones/reversiones/0048_revertir_departamento_en_la_cuenta.sql",
          ),
          "utf8",
        );
        const correr = async (confirmar = false) => {
          await m2.dueno.query("begin");
          try {
            if (confirmar) await m2.dueno.query("set local pedernal.confirmar_reversion = 'SI'");
            await m2.dueno.query(sql);
            await m2.dueno.query("commit");
          } catch (error) {
            await m2.dueno.query("rollback");
            throw error;
          }
        };
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect(
          (await m2.dueno.query("select 1 from cuenta_consumo where departamento_id is not null"))
            .rowCount,
        ).toBe(1);
        await correr(true);
        expect(
          (
            await m2.dueno.query(
              "select 1 from information_schema.columns where table_name = 'cuenta_consumo' and column_name = 'departamento_id'",
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await m2.dueno.query(
              "select 1 from pg_trigger where tgname = 'cuenta_departamento_validar'",
            )
          ).rowCount,
        ).toBe(0);
        await correr(); // repetirla no cambia nada
        expect(
          (
            await m2.dueno.query(
              "select 1 from migracion where nombre = '0048_departamento_en_la_cuenta.sql'",
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await m2.cerrar();
      }
    });
  });
});
