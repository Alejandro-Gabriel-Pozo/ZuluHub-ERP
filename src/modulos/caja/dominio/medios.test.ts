import { describe, expect, it } from "vitest";
import {
  DATOS_DEL_COBRO,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
  type DatoDelCobro,
  type TipoDeCuenta,
  type TipoDeMedio,
} from "../estados";
import {
  CUENTAS_ADMITIDAS,
  DATOS_ADMITIDOS_POR_MEDIO,
  cuentaAdmitidaPorMedio,
  cuentaDeCobroRequerida,
  validarDatosQuePide,
  validarParDeCobro,
  type CuentaVista,
  type DatosQuePideElMedio,
} from "./medios";

describe("compatibilidad medio ↔ cuenta de cobro (e3 §3.3)", () => {
  /** La tabla de e3 §3.3 escrita aparte. */
  const tabla: Readonly<Record<TipoDeMedio, readonly TipoDeCuenta[]>> = {
    EFECTIVO: [],
    TARJETA_DEBITO: ["TERMINAL"],
    TARJETA_CREDITO: ["TERMINAL"],
    QR: ["QR", "TERMINAL"],
    TRANSFERENCIA: ["CUENTA_BANCARIA"],
    OTRO: ["TERMINAL", "QR", "CUENTA_BANCARIA"],
  };

  it("cada combinación de tipo de medio y de cuenta da lo de la tabla", () => {
    for (const medio of TIPOS_DE_MEDIO) {
      for (const cuenta of TIPOS_DE_CUENTA) {
        expect(cuentaAdmitidaPorMedio(medio, cuenta)).toBe(tabla[medio].includes(cuenta));
      }
      expect([...CUENTAS_ADMITIDAS[medio]]).toEqual([...tabla[medio]]);
    }
  });

  it("la cuenta de cobro nunca es obligatoria (decisión 151)", () => {
    for (const medio of TIPOS_DE_MEDIO) expect(cuentaDeCobroRequerida(medio)).toBe(false);
  });
});

describe("validarParDeCobro: el espejo de par_de_cobro_validar", () => {
  const cuenta = (c: Partial<CuentaVista> = {}): CuentaVista => ({
    tipo: "TERMINAL",
    activa: true,
    sucursalId: "s1",
    ...c,
  });
  const validar = (entrada: {
    medio?: { tipo: TipoDeMedio; activo: boolean } | null;
    cuentaDeCobroId?: string | null;
    cuenta?: CuentaVista | null;
  }) =>
    validarParDeCobro({
      medio: entrada.medio === undefined ? { tipo: "TARJETA_DEBITO", activo: true } : entrada.medio,
      cuentaDeCobroId: entrada.cuentaDeCobroId === undefined ? "c1" : entrada.cuentaDeCobroId,
      cuenta: entrada.cuenta === undefined ? cuenta() : entrada.cuenta,
      sucursalDeLaCaja: "s1",
    });

  it("un medio inexistente o inactivo se rechaza antes que la cuenta", () => {
    expect(validar({ medio: null, cuentaDeCobroId: null, cuenta: null })).toEqual({
      ok: false,
      error: "MEDIO_NO_ENCONTRADO",
    });
    expect(validar({ medio: { tipo: "TARJETA_DEBITO", activo: false } })).toEqual({
      ok: false,
      error: "MEDIO_INACTIVO",
    });
  });

  it("sin cuenta: pasa con cualquier medio activo y devuelve su tipo (la cuenta es opcional)", () => {
    for (const tipo of TIPOS_DE_MEDIO) {
      expect(
        validar({ medio: { tipo, activo: true }, cuentaDeCobroId: null, cuenta: null }),
      ).toEqual({ ok: true, valor: tipo });
    }
  });

  it("el efectivo con cuenta es CUENTA_DE_COBRO_NO_ADMITIDA, exista o no la cuenta", () => {
    expect(validar({ medio: { tipo: "EFECTIVO", activo: true } })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_NO_ADMITIDA",
    });
    expect(validar({ medio: { tipo: "EFECTIVO", activo: true }, cuenta: null })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_NO_ADMITIDA",
    });
  });

  it("una cuenta indicada que no existe es CUENTA_DE_COBRO_NO_ENCONTRADA", () => {
    expect(validar({ cuenta: null })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_NO_ENCONTRADA",
    });
  });

  it("cuenta de otra sucursal, luego inactiva, luego incompatible (el orden de la base)", () => {
    expect(validar({ cuenta: cuenta({ sucursalId: "s2", activa: false, tipo: "QR" }) })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
    });
    expect(validar({ cuenta: cuenta({ activa: false, tipo: "QR" }) })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_INACTIVA",
    });
    expect(validar({ cuenta: cuenta({ tipo: "QR" }) })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_INCOMPATIBLE",
    });
  });

  it("una cuenta de la sucursal, activa y compatible pasa", () => {
    expect(validar({ cuenta: cuenta() })).toEqual({ ok: true, valor: "TARJETA_DEBITO" });
    expect(
      validar({
        medio: { tipo: "TRANSFERENCIA", activo: true },
        cuenta: cuenta({ tipo: "CUENTA_BANCARIA" }),
      }),
    ).toEqual({
      ok: true,
      valor: "TRANSFERENCIA",
    });
  });
});

describe("qué datos admite cada tipo de medio (medio_de_pago_datos_ck)", () => {
  /** El CHECK de 0027 transcripto: `pide` es lo que el medio habilita. */
  const ck = (tipo: TipoDeMedio, p: DatosQuePideElMedio): boolean =>
    (["EFECTIVO", "QR", "OTRO"].includes(tipo) &&
      !(p.cupon || p.ultimos4 || p.marca || p.cuotas || p.dni)) ||
    (tipo === "TARJETA_DEBITO" && !(p.cuotas || p.dni)) ||
    (tipo === "TARJETA_CREDITO" && !p.dni) ||
    (tipo === "TRANSFERENCIA" && !(p.cupon || p.ultimos4 || p.marca || p.cuotas));

  it("coincide con el CHECK en los 6 tipos y las 32 combinaciones", () => {
    for (const tipo of TIPOS_DE_MEDIO) {
      for (let mascara = 0; mascara < 32; mascara += 1) {
        const pide = Object.fromEntries(
          DATOS_DEL_COBRO.map((d, i) => [d, (mascara & (1 << i)) !== 0]),
        ) as DatosQuePideElMedio;
        expect(validarDatosQuePide(tipo, pide).ok).toBe(ck(tipo, pide));
      }
    }
  });

  it("nombra el primer dato que el tipo no admite, en el orden cupón, últimos 4, marca, cuotas, DNI", () => {
    const todos = { cupon: true, ultimos4: true, marca: true, cuotas: true, dni: true };
    expect(validarDatosQuePide("EFECTIVO", todos)).toEqual({
      ok: false,
      error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cupon" },
    });
    expect(validarDatosQuePide("TARJETA_DEBITO", todos)).toEqual({
      ok: false,
      error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cuotas" },
    });
    expect(validarDatosQuePide("TARJETA_CREDITO", todos)).toEqual({
      ok: false,
      error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "dni" },
    });
    expect(validarDatosQuePide("TRANSFERENCIA", todos)).toEqual({
      ok: false,
      error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cupon" },
    });
    expect(
      validarDatosQuePide("QR", {
        ...todos,
        cupon: false,
        ultimos4: false,
        marca: false,
        cuotas: false,
      }),
    ).toEqual({
      ok: false,
      error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "dni" },
    });
  });

  it("la tabla de datos admitidos es la de la decisión 129", () => {
    const esperada: Record<TipoDeMedio, readonly DatoDelCobro[]> = {
      EFECTIVO: [],
      QR: [],
      OTRO: [],
      TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
      TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
      TRANSFERENCIA: ["dni"],
    };
    expect(DATOS_ADMITIDOS_POR_MEDIO).toEqual(esperada);
  });
});

describe("validarParDeCobro sin exigir activos (declarar un total: el par pudo tener actividad y desactivarse)", () => {
  const cuentaInactiva: CuentaVista = { tipo: "TERMINAL", activa: false, sucursalId: "s1" };
  const validar = (exigirActivos: boolean | undefined, medioActivo: boolean, cuenta: CuentaVista) =>
    validarParDeCobro({
      medio: { tipo: "TARJETA_DEBITO", activo: medioActivo },
      cuentaDeCobroId: "c1",
      cuenta,
      sucursalDeLaCaja: "s1",
      ...(exigirActivos === undefined ? {} : { exigirActivos }),
    });

  it("por omisión (y con true) exige el medio y la cuenta activos", () => {
    for (const exigir of [undefined, true]) {
      expect(validar(exigir, false, { ...cuentaInactiva, activa: true })).toEqual({
        ok: false,
        error: "MEDIO_INACTIVO",
      });
      expect(validar(exigir, true, cuentaInactiva)).toEqual({
        ok: false,
        error: "CUENTA_DE_COBRO_INACTIVA",
      });
    }
  });

  it("con false acepta un medio y una cuenta desactivados, pero el resto de las reglas siguen", () => {
    expect(validar(false, false, cuentaInactiva)).toEqual({ ok: true, valor: "TARJETA_DEBITO" });
    expect(validar(false, true, { ...cuentaInactiva, sucursalId: "s2" })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
    });
    expect(validar(false, true, { ...cuentaInactiva, tipo: "QR" })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_INCOMPATIBLE",
    });
    expect(
      validarParDeCobro({
        medio: null,
        cuentaDeCobroId: null,
        cuenta: null,
        sucursalDeLaCaja: "s1",
        exigirActivos: false,
      }),
    ).toEqual({ ok: false, error: "MEDIO_NO_ENCONTRADO" });
  });
});
