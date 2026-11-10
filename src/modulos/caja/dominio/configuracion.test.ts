import { describe, expect, it } from "vitest";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { DATOS_DEL_COBRO, TIPOS_DE_CUENTA, TIPOS_DE_MEDIO, type TipoDeMedio } from "../estados";
import {
  LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO,
  decidirAltaDeCaja,
  decidirAltaDeCuenta,
  decidirAltaDeMedio,
  decidirCambioDeEstado,
  decidirDesactivacionDeMedio,
  decidirEdicionDeCaja,
  decidirEdicionDeCuenta,
  decidirEdicionDeMedio,
  identificadorExternoValido,
  NOMBRE_DE_LA_CAJA_POR_DEFECTO,
  nombreDeCajaValido,
  nombreDeCuentaValido,
  nombreDeMedioValido,
  tipoDeCuentaValido,
  tipoDeMedioValido,
  type Caja,
  type CuentaDeCobro,
  type MedioDePago,
} from "./configuracion";
import type { DatosQuePideElMedio } from "./medios";

const S1 = sucursalId("s-1");
const S2 = sucursalId("s-2");
const NADA: DatosQuePideElMedio = {
  cupon: false,
  ultimos4: false,
  marca: false,
  cuotas: false,
  dni: false,
};

const caja = (c: Partial<Caja> = {}): Caja => ({
  id: "c-1",
  sucursalId: S1,
  nombre: "Caja 1",
  activa: true,
  version: 3,
  ...c,
});
const medio = (m: Partial<MedioDePago> = {}): MedioDePago => ({
  id: "m-1",
  tipo: "TARJETA_DEBITO",
  nombre: "Visa débito",
  activo: true,
  pide: NADA,
  version: 3,
  ...m,
});
const cuenta = (c: Partial<CuentaDeCobro> = {}): CuentaDeCobro => ({
  id: "q-1",
  tipo: "TERMINAL",
  nombre: "Terminal 1",
  identificadorExterno: "T-100",
  sucursalId: S1,
  activa: true,
  version: 3,
  ...c,
});

describe("los nombres de caja, medio y cuenta", () => {
  const casos = [
    ["caja", nombreDeCajaValido, LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA, 100, "NOMBRE_DE_CAJA_INVALIDO"],
    [
      "cuenta",
      nombreDeCuentaValido,
      LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA,
      60,
      "NOMBRE_DE_CUENTA_INVALIDO",
    ],
    [
      "medio",
      nombreDeMedioValido,
      LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO,
      60,
      "NOMBRE_DE_MEDIO_INVALIDO",
    ],
  ] as const;

  it.each(casos)(
    "%s: el tope es el de la base y se mide en caracteres",
    (_n, validar, tope, esperado, codigo) => {
      expect(tope).toBe(esperado);
      expect(validar("a".repeat(tope))).toEqual({ ok: true, valor: "a".repeat(tope) });
      expect(validar("a".repeat(tope + 1))).toEqual({ ok: false, error: codigo });
      // Las letras con tilde cuentan una sola vez (NFC): el nombre más largo que entra, entra con tildes también.
      expect(validar("é".repeat(tope))).toEqual({ ok: true, valor: "é".repeat(tope) });
      expect(validar("é".repeat(tope))).toEqual({ ok: true, valor: "é".repeat(tope) });
    },
  );

  it.each(casos)(
    "%s: recorta los extremos, junta los espacios repetidos y admite una letra sola",
    (_n, validar) => {
      expect(validar("  Caja   uno  ")).toEqual({ ok: true, valor: "Caja uno" });
      expect(validar("A")).toEqual({ ok: true, valor: "A" });
      expect(validar("Mostrador (salón) #2 - 50%")).toEqual({
        ok: true,
        valor: "Mostrador (salón) #2 - 50%",
      });
    },
  );

  it.each(casos)(
    "%s: rechaza lo vacío, los blancos y lo que no está en la lista de permitidos",
    (_n, validar, _t, _e, codigo) => {
      for (const malo of [
        "",
        "   ",
        "\t",
        "a\nb",
        "a<b",
        "a>b",
        "a=b",
        "a@b",
        "😀",
        "a​b",
        "a‮b",
        "a\u0000b",
      ]) {
        expect(validar(malo), JSON.stringify(malo)).toEqual({ ok: false, error: codigo });
      }
    },
  );

  it("el nombre del medio es opcional: null es «sin nombre» y un texto en blanco es inválido", () => {
    expect(nombreDeMedioValido(null)).toEqual({ ok: true, valor: null });
    expect(nombreDeMedioValido("")).toEqual({ ok: false, error: "NOMBRE_DE_MEDIO_INVALIDO" });
    expect(nombreDeMedioValido("  ")).toEqual({ ok: false, error: "NOMBRE_DE_MEDIO_INVALIDO" });
  });
});

describe("el identificador externo de la cuenta", () => {
  it("es opcional, de hasta 40 caracteres y de la lista cerrada de la base", () => {
    expect(LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO).toBe(40);
    expect(identificadorExternoValido(null)).toEqual({ ok: true, valor: null });
    expect(identificadorExternoValido("T-100/a_b.c 9")).toEqual({
      ok: true,
      valor: "T-100/a_b.c 9",
    });
    const tope = "a".repeat(40);
    expect(identificadorExternoValido(tope)).toEqual({ ok: true, valor: tope });
    expect(identificadorExternoValido(`${tope}a`)).toEqual({
      ok: false,
      error: "IDENTIFICADOR_EXTERNO_INVALIDO",
    });
    expect(identificadorExternoValido("a")).toEqual({ ok: true, valor: "a" });
  });

  it("recorta los extremos y rechaza lo vacío y lo que no está en la lista", () => {
    expect(identificadorExternoValido("  T1  ")).toEqual({ ok: true, valor: "T1" });
    // Con los extremos recortados el tope es sobre lo que se guarda: 40 + blancos entra.
    expect(identificadorExternoValido(`  ${"a".repeat(40)}  `)).toEqual({
      ok: true,
      valor: "a".repeat(40),
    });
    for (const malo of ["", "   ", "a;b", "a<b", "é", "a\nb", "a=b", "a@b", "$", "😀"]) {
      expect(identificadorExternoValido(malo), JSON.stringify(malo)).toEqual({
        ok: false,
        error: "IDENTIFICADOR_EXTERNO_INVALIDO",
      });
    }
  });

  it("la forma es de principio a fin: un carácter malo al principio o al final también falla", () => {
    expect(identificadorExternoValido("é1")).toEqual({
      ok: false,
      error: "IDENTIFICADOR_EXTERNO_INVALIDO",
    });
    expect(identificadorExternoValido("1é")).toEqual({
      ok: false,
      error: "IDENTIFICADOR_EXTERNO_INVALIDO",
    });
    expect(identificadorExternoValido("a\nb\nc")).toEqual({
      ok: false,
      error: "IDENTIFICADOR_EXTERNO_INVALIDO",
    });
  });
});

describe("los tipos", () => {
  it("cada tipo del vocabulario se acepta y cualquier otro texto se rechaza", () => {
    for (const tipo of TIPOS_DE_MEDIO)
      expect(tipoDeMedioValido(tipo)).toEqual({ ok: true, valor: tipo });
    for (const tipo of TIPOS_DE_CUENTA)
      expect(tipoDeCuentaValido(tipo)).toEqual({ ok: true, valor: tipo });
    for (const malo of ["", "efectivo", "EFECTIVO ", "TERMINAL", "DEVOLUCION", "constructor"]) {
      expect(tipoDeMedioValido(malo), malo).toEqual({ ok: false, error: "TIPO_DE_MEDIO_INVALIDO" });
    }
    for (const malo of ["", "terminal", "TERMINAL ", "EFECTIVO", "toString"]) {
      expect(tipoDeCuentaValido(malo), malo).toEqual({
        ok: false,
        error: "TIPO_DE_CUENTA_INVALIDO",
      });
    }
  });
});

describe("la caja por defecto (decisión 165)", () => {
  it("se llama «Caja 1» y es un nombre de caja válido tal cual (la base lo acepta igual)", () => {
    expect(NOMBRE_DE_LA_CAJA_POR_DEFECTO).toBe("Caja 1");
    expect(nombreDeCajaValido(NOMBRE_DE_LA_CAJA_POR_DEFECTO)).toEqual({
      ok: true,
      valor: "Caja 1",
    });
  });
});

describe("decidirAltaDeCaja", () => {
  it("sin otra con ese nombre se crea; activa, ya estaba; desactivada, hay que reactivarla", () => {
    expect(decidirAltaDeCaja(null)).toEqual({ ok: true, valor: "CREAR" });
    expect(decidirAltaDeCaja(caja())).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(decidirAltaDeCaja(caja({ activa: false }))).toEqual({
      ok: false,
      error: "CAJA_INACTIVA_CON_ESE_NOMBRE",
    });
  });
});

describe("decidirAltaDeMedio", () => {
  const sin = { conEseNombre: null, efectivo: null };

  it("sin otro con ese nombre se crea, de cualquier tipo", () => {
    for (const tipo of TIPOS_DE_MEDIO) {
      expect(decidirAltaDeMedio({ tipo, nombre: "X" }, sin)).toEqual({ ok: true, valor: "CREAR" });
      expect(decidirAltaDeMedio({ tipo, nombre: null }, sin)).toEqual({ ok: true, valor: "CREAR" });
    }
  });

  it("el mismo medio activo ya estaba; el mismo desactivado se reactiva; uno de otro tipo con ese nombre es duplicado", () => {
    const existente = medio();
    expect(
      decidirAltaDeMedio(
        { tipo: "TARJETA_DEBITO", nombre: "Visa débito" },
        { ...sin, conEseNombre: existente },
      ),
    ).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(
      decidirAltaDeMedio(
        { tipo: "TARJETA_DEBITO", nombre: "Visa débito" },
        { ...sin, conEseNombre: medio({ activo: false }) },
      ),
    ).toEqual({ ok: false, error: "MEDIO_INACTIVO_CON_ESE_NOMBRE" });
    expect(
      decidirAltaDeMedio(
        { tipo: "TARJETA_CREDITO", nombre: "Visa débito" },
        { ...sin, conEseNombre: existente },
      ),
    ).toEqual({ ok: false, error: "MEDIO_DUPLICADO" });
    // Un medio de otro tipo desactivado también es duplicado: el tipo se mira antes que el estado.
    expect(
      decidirAltaDeMedio(
        { tipo: "QR", nombre: "Visa débito" },
        { ...sin, conEseNombre: medio({ activo: false }) },
      ),
    ).toEqual({ ok: false, error: "MEDIO_DUPLICADO" });
  });

  it("hay un solo efectivo: el mismo pedido ya estaba y cualquier otro da EFECTIVO_YA_EXISTE", () => {
    const efectivo = medio({ id: "e", tipo: "EFECTIVO", nombre: null });
    expect(
      decidirAltaDeMedio({ tipo: "EFECTIVO", nombre: null }, { conEseNombre: efectivo, efectivo }),
    ).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(
      decidirAltaDeMedio(
        { tipo: "EFECTIVO", nombre: "Caja chica" },
        { conEseNombre: null, efectivo },
      ),
    ).toEqual({ ok: false, error: "EFECTIVO_YA_EXISTE" });
    const conNombre = medio({ id: "e", tipo: "EFECTIVO", nombre: "Efectivo" });
    expect(
      decidirAltaDeMedio(
        { tipo: "EFECTIVO", nombre: "Efectivo" },
        { conEseNombre: conNombre, efectivo: conNombre },
      ),
    ).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(
      decidirAltaDeMedio(
        { tipo: "EFECTIVO", nombre: null },
        { conEseNombre: null, efectivo: conNombre },
      ),
    ).toEqual({ ok: false, error: "EFECTIVO_YA_EXISTE" });
  });

  it("un efectivo que ya existe no frena el alta de otro tipo", () => {
    const efectivo = medio({ id: "e", tipo: "EFECTIVO", nombre: null });
    expect(
      decidirAltaDeMedio({ tipo: "QR", nombre: "QR 1" }, { conEseNombre: null, efectivo }),
    ).toEqual({ ok: true, valor: "CREAR" });
  });

  it("pedir efectivo sin que haya uno lo crea; y su nombre puede chocar con otro medio", () => {
    expect(decidirAltaDeMedio({ tipo: "EFECTIVO", nombre: null }, sin)).toEqual({
      ok: true,
      valor: "CREAR",
    });
    expect(
      decidirAltaDeMedio(
        { tipo: "EFECTIVO", nombre: "Visa débito" },
        { ...sin, conEseNombre: medio() },
      ),
    ).toEqual({ ok: false, error: "MEDIO_DUPLICADO" });
  });
});

describe("decidirAltaDeCuenta", () => {
  const pedido = { tipo: "TERMINAL", identificadorExterno: "T-100", sucursalId: S1 } as const;

  it("sin otra con ese nombre se crea", () => {
    expect(decidirAltaDeCuenta(pedido, null)).toEqual({ ok: true, valor: "CREAR" });
  });

  it("la misma cuenta activa ya estaba", () => {
    expect(decidirAltaDeCuenta(pedido, cuenta())).toEqual({ ok: true, valor: "YA_EXISTIA" });
    expect(
      decidirAltaDeCuenta(
        { ...pedido, identificadorExterno: null },
        cuenta({ identificadorExterno: null }),
      ),
    ).toEqual({ ok: true, valor: "YA_EXISTIA" });
  });

  it("cualquier diferencia, o estar desactivada, es CUENTA_DUPLICADA", () => {
    const duplicada = { ok: false, error: "CUENTA_DUPLICADA" };
    expect(decidirAltaDeCuenta(pedido, cuenta({ activa: false }))).toEqual(duplicada);
    expect(decidirAltaDeCuenta(pedido, cuenta({ tipo: "QR" }))).toEqual(duplicada);
    expect(decidirAltaDeCuenta(pedido, cuenta({ identificadorExterno: "otro" }))).toEqual(
      duplicada,
    );
    expect(decidirAltaDeCuenta(pedido, cuenta({ identificadorExterno: null }))).toEqual(duplicada);
    expect(decidirAltaDeCuenta({ ...pedido, identificadorExterno: null }, cuenta())).toEqual(
      duplicada,
    );
    expect(decidirAltaDeCuenta(pedido, cuenta({ sucursalId: S2 }))).toEqual(duplicada);
  });
});

describe("decidirEdicionDeCaja", () => {
  it("no existe → CAJA_NO_ENCONTRADA", () => {
    expect(decidirEdicionDeCaja(null, 3, "Caja 1")).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
  });

  it("el mismo nombre no cambia nada, aunque la versión esperada sea vieja", () => {
    expect(decidirEdicionDeCaja(caja(), 3, "Caja 1")).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
    expect(decidirEdicionDeCaja(caja(), 1, "Caja 1")).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
  });

  it("otro nombre con la versión vigente edita; con otra, VERSION_DESACTUALIZADA", () => {
    expect(decidirEdicionDeCaja(caja(), 3, "Caja 2")).toEqual({ ok: true, valor: "EDITAR" });
    expect(decidirEdicionDeCaja(caja(), 2, "Caja 2")).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirEdicionDeCaja(caja(), 4, "Caja 2")).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
  });

  it("cambiar solo las mayúsculas es un cambio", () => {
    expect(decidirEdicionDeCaja(caja(), 3, "caja 1")).toEqual({ ok: true, valor: "EDITAR" });
  });
});

describe("decidirEdicionDeMedio", () => {
  const cambios = (nombre: string | null, pide: Partial<DatosQuePideElMedio> = {}) => ({
    nombre,
    pide: { ...NADA, ...pide },
  });

  it("no existe → MEDIO_NO_ENCONTRADO", () => {
    expect(decidirEdicionDeMedio(null, 3, cambios("X"))).toEqual({
      ok: false,
      error: "MEDIO_NO_ENCONTRADO",
    });
  });

  it("lo mismo que hay no cambia nada, aunque la versión sea vieja", () => {
    expect(decidirEdicionDeMedio(medio(), 3, cambios("Visa débito"))).toEqual({
      ok: true,
      valor: "SIN_CAMBIOS",
    });
    expect(decidirEdicionDeMedio(medio(), 1, cambios("Visa débito"))).toEqual({
      ok: true,
      valor: "SIN_CAMBIOS",
    });
    const conDatos = medio({ pide: { ...NADA, cupon: true, marca: true } });
    expect(
      decidirEdicionDeMedio(conDatos, 1, cambios("Visa débito", { cupon: true, marca: true })),
    ).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
  });

  it("cambiar el nombre (también a «sin nombre») o cualquiera de los datos es un cambio, con control de versión", () => {
    expect(decidirEdicionDeMedio(medio(), 3, cambios("Otro"))).toEqual({
      ok: true,
      valor: "EDITAR",
    });
    expect(decidirEdicionDeMedio(medio(), 3, cambios(null))).toEqual({ ok: true, valor: "EDITAR" });
    expect(decidirEdicionDeMedio(medio({ nombre: null }), 3, cambios("Visa"))).toEqual({
      ok: true,
      valor: "EDITAR",
    });
    for (const dato of ["cupon", "ultimos4", "marca"] as const) {
      expect(decidirEdicionDeMedio(medio(), 3, cambios("Visa débito", { [dato]: true }))).toEqual({
        ok: true,
        valor: "EDITAR",
      });
      expect(decidirEdicionDeMedio(medio(), 2, cambios("Visa débito", { [dato]: true }))).toEqual({
        ok: false,
        error: "VERSION_DESACTUALIZADA",
      });
      // Apagar un dato que estaba prendido también es un cambio.
      expect(
        decidirEdicionDeMedio(
          medio({ pide: { ...NADA, [dato]: true } }),
          3,
          cambios("Visa débito"),
        ),
      ).toEqual({ ok: true, valor: "EDITAR" });
    }
    const credito = medio({ tipo: "TARJETA_CREDITO" });
    expect(decidirEdicionDeMedio(credito, 3, cambios("Visa débito", { cuotas: true }))).toEqual({
      ok: true,
      valor: "EDITAR",
    });
    const transferencia = medio({ tipo: "TRANSFERENCIA" });
    expect(decidirEdicionDeMedio(transferencia, 3, cambios("Visa débito", { dni: true }))).toEqual({
      ok: true,
      valor: "EDITAR",
    });
  });

  it("habilitar un dato que el tipo no admite se rechaza con el dato, aunque no haya otro cambio y la versión sea vieja", () => {
    for (const tipo of TIPOS_DE_MEDIO) {
      const base = medio({ tipo, nombre: "X" });
      for (const dato of DATOS_DEL_COBRO) {
        const admitido = decidirEdicionDeMedio(base, 3, cambios("X", { [dato]: true }));
        const estaAdmitido = admitidoPor(tipo, dato);
        expect(admitido.ok, `${tipo} ${dato}`).toBe(estaAdmitido);
        if (!estaAdmitido) {
          expect(admitido).toEqual({
            ok: false,
            error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato },
          });
          expect(decidirEdicionDeMedio(base, 1, cambios("X", { [dato]: true }))).toEqual({
            ok: false,
            error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato },
          });
        }
      }
    }
  });

  /** Lo de la decisión 129 escrito aparte, para no repetir la tabla del código. */
  function admitidoPor(tipo: TipoDeMedio, dato: (typeof DATOS_DEL_COBRO)[number]): boolean {
    const tabla: Record<TipoDeMedio, readonly string[]> = {
      EFECTIVO: [],
      QR: [],
      OTRO: [],
      TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
      TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
      TRANSFERENCIA: ["dni"],
    };
    return tabla[tipo].includes(dato);
  }
});

describe("decidirEdicionDeCuenta", () => {
  const cambios = {
    nombre: "Terminal 1",
    identificadorExterno: "T-100",
    sucursalId: S1,
  };

  it("no existe → CUENTA_DE_COBRO_NO_ENCONTRADA", () => {
    expect(decidirEdicionDeCuenta(null, 3, cambios)).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_NO_ENCONTRADA",
    });
  });

  it("lo mismo que hay no cambia nada, aunque la versión sea vieja", () => {
    expect(decidirEdicionDeCuenta(cuenta(), 3, cambios)).toEqual({
      ok: true,
      valor: "SIN_CAMBIOS",
    });
    expect(decidirEdicionDeCuenta(cuenta(), 1, cambios)).toEqual({
      ok: true,
      valor: "SIN_CAMBIOS",
    });
    expect(
      decidirEdicionDeCuenta(cuenta({ identificadorExterno: null }), 1, {
        ...cambios,
        identificadorExterno: null,
      }),
    ).toEqual({ ok: true, valor: "SIN_CAMBIOS" });
  });

  it("cambiar el nombre, el identificador (o quitarlo) o la sucursal edita con la versión vigente y falla con otra", () => {
    const cambiados = [
      { ...cambios, nombre: "Terminal 2" },
      { ...cambios, identificadorExterno: "T-200" },
      { ...cambios, identificadorExterno: null },
      { ...cambios, sucursalId: S2 },
    ];
    for (const cambio of cambiados) {
      expect(decidirEdicionDeCuenta(cuenta(), 3, cambio)).toEqual({ ok: true, valor: "EDITAR" });
      expect(decidirEdicionDeCuenta(cuenta(), 2, cambio)).toEqual({
        ok: false,
        error: "VERSION_DESACTUALIZADA",
      });
    }
    expect(decidirEdicionDeCuenta(cuenta({ identificadorExterno: null }), 3, cambios)).toEqual({
      ok: true,
      valor: "EDITAR",
    });
  });
});

describe("desactivar y reactivar", () => {
  it("ya está como se pide → YA_ESTABA; si no, CAMBIAR", () => {
    expect(decidirCambioDeEstado(true, true)).toBe("YA_ESTABA");
    expect(decidirCambioDeEstado(false, false)).toBe("YA_ESTABA");
    expect(decidirCambioDeEstado(true, false)).toBe("CAMBIAR");
    expect(decidirCambioDeEstado(false, true)).toBe("CAMBIAR");
  });

  it("el efectivo no se desactiva nunca; los demás medios sí, y desactivar uno ya inactivo es idempotente", () => {
    for (const tipo of TIPOS_DE_MEDIO) {
      const activo = decidirDesactivacionDeMedio(medio({ tipo }));
      const inactivo = decidirDesactivacionDeMedio(medio({ tipo, activo: false }));
      if (tipo === "EFECTIVO") {
        expect(activo).toEqual({ ok: false, error: "EFECTIVO_NO_SE_DESACTIVA" });
        expect(inactivo).toEqual({ ok: false, error: "EFECTIVO_NO_SE_DESACTIVA" });
      } else {
        expect(activo).toEqual({ ok: true, valor: "CAMBIAR" });
        expect(inactivo).toEqual({ ok: true, valor: "YA_ESTABA" });
      }
    }
  });
});
