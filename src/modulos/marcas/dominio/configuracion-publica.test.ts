import { describe, expect, it } from "vitest";
import {
  decidirConfiguracionPublica,
  type DatosParaLaConfiguracionPublica,
  type VersionPublicaDeMarca,
} from "./configuracion-publica";
import { normalizarHost, type Host } from "./host";

const host = (texto: string): Host => {
  const r = normalizarHost(texto);
  if (!r.ok) throw new Error("host de prueba inválido");
  return r.valor;
};

const AHORA = new Date("2026-10-13T12:00:00.000Z");
const ANTES = new Date("2026-10-01T00:00:00.000Z");
const DESPUES = new Date("2026-11-01T00:00:00.000Z");

const TEMA = {
  primary: "#112233",
  "on-primary": "#ffffff",
  secondary: "#445566",
  accent: "#778899",
} as const;

const version = (parcial: Partial<VersionPublicaDeMarca> = {}): VersionPublicaDeMarca => ({
  numero: 1,
  vigenteDesde: ANTES,
  nombreVisible: "Mi Calendario",
  tema: TEMA,
  ...parcial,
});

const datos = (
  cadena: DatosParaLaConfiguracionPublica["cadena"],
  parcial: Partial<DatosParaLaConfiguracionPublica> = {},
): DatosParaLaConfiguracionPublica => ({
  cadena,
  hostCanonico: host("app.micalendario.test"),
  ahora: AHORA,
  ...parcial,
});

describe("decidirConfiguracionPublica", () => {
  it("devuelve el nombre, el tema y el host canónico de la versión vigente, y nada más", () => {
    const r = decidirConfiguracionPublica(datos([[version()]]));
    expect(r).toEqual({
      nombre: "Mi Calendario",
      tema: TEMA,
      hostCanonico: "app.micalendario.test",
    });
    expect(Object.keys(r ?? {}).sort()).toEqual(["hostCanonico", "nombre", "tema"]);
  });

  it("sin host canónico, hostCanonico es null (el resto se sirve igual)", () => {
    const r = decidirConfiguracionPublica(datos([[version()]], { hostCanonico: null }));
    expect(r).toEqual({ nombre: "Mi Calendario", tema: TEMA, hostCanonico: null });
  });

  it("el tema devuelto es un objeto nuevo: no comparte referencia con el dato de la base", () => {
    const original = { ...TEMA };
    const r = decidirConfiguracionPublica(datos([[version({ tema: original })]]));
    expect(r?.tema).toEqual(original);
    expect(r?.tema).not.toBe(original);
  });

  describe("qué versión rige", () => {
    it("rige la de mayor número entre las que ya empezaron", () => {
      const r = decidirConfiguracionPublica(
        datos([
          [
            version({ numero: 1, nombreVisible: "Uno" }),
            version({ numero: 3, nombreVisible: "Tres" }),
            version({ numero: 2, nombreVisible: "Dos" }),
          ],
        ]),
      );
      expect(r?.nombre).toBe("Tres");
    });

    it("una versión programada (todavía no empezó) no rige, aunque sea de número mayor", () => {
      const r = decidirConfiguracionPublica(
        datos([
          [
            version({ numero: 1, nombreVisible: "Vigente" }),
            version({ numero: 2, nombreVisible: "Futura", vigenteDesde: DESPUES }),
          ],
        ]),
      );
      expect(r?.nombre).toBe("Vigente");
    });

    it("la que empieza justo en `ahora` ya rige", () => {
      const r = decidirConfiguracionPublica(
        datos([[version({ numero: 1, nombreVisible: "Justo", vigenteDesde: AHORA })]]),
      );
      expect(r?.nombre).toBe("Justo");
    });

    it("usa el `ahora` que le dan: la misma versión rige o no según la hora", () => {
      const futura = [version({ vigenteDesde: DESPUES })];
      expect(decidirConfiguracionPublica(datos([futura]))).toBeNull();
      expect(decidirConfiguracionPublica(datos([futura], { ahora: DESPUES }))?.nombre).toBe(
        "Mi Calendario",
      );
    });

    it("el tema de una versión que ya no rige, o que no rige todavía, no se mira (aunque sea inválido)", () => {
      const r = decidirConfiguracionPublica(
        datos([
          [
            version({ numero: 1, tema: { primary: "rojo" } }),
            version({ numero: 2, tema: TEMA }),
            version({ numero: 3, tema: { primary: "rojo" }, vigenteDesde: DESPUES }),
          ],
        ]),
      );
      expect(r?.tema).toEqual(TEMA);
    });

    it("sin ninguna versión visible, o con todas programadas, no hay configuración", () => {
      expect(decidirConfiguracionPublica(datos([]))).toBeNull();
      expect(decidirConfiguracionPublica(datos([[]]))).toBeNull();
      expect(decidirConfiguracionPublica(datos([[version({ vigenteDesde: DESPUES })]]))).toBeNull();
    });
  });

  describe("el nombre es el de la propia marca: no se hereda", () => {
    it("una marca sin versión propia no toma el nombre de su padre", () => {
      const padre = [version({ nombreVisible: "Marca principal" })];
      expect(decidirConfiguracionPublica(datos([[], padre]))).toBeNull();
    });

    it("una versión propia sin nombre no toma el de su padre ni el de su abuelo", () => {
      const abuelo = [version({ nombreVisible: "Abuelo" })];
      const padre = [version({ nombreVisible: "Padre" })];
      expect(
        decidirConfiguracionPublica(datos([[version({ nombreVisible: null })], padre, abuelo])),
      ).toBeNull();
    });

    it.each([
      ["con marcado", "<b>Hola</b>"],
      ["con un carácter de control", "Hola\nmundo"],
      ["con un carácter invisible", "Ho​la"],
      ["vacío", ""],
      ["solo espacios", "   "],
      ["de más de 60 caracteres", "x".repeat(61)],
    ])("un nombre %s no se puede mostrar: no se sirve", (_motivo, nombreVisible) => {
      expect(decidirConfiguracionPublica(datos([[version({ nombreVisible })]]))).toBeNull();
    });

    it("el nombre sale en su forma canónica (recortado y en NFC)", () => {
      const r = decidirConfiguracionPublica(datos([[version({ nombreVisible: "  Café Lola  " })]]));
      expect(r?.nombre).toBe("Café Lola");
    });

    it("60 caracteres es el máximo permitido", () => {
      const nombre = "x".repeat(60);
      expect(
        decidirConfiguracionPublica(datos([[version({ nombreVisible: nombre })]]))?.nombre,
      ).toBe(nombre);
    });
  });

  describe("el tema hereda token por token por la cadena [marca, padre, abuelo]", () => {
    it("cada token sale del primer eslabón que lo define", () => {
      const r = decidirConfiguracionPublica(
        datos([
          [version({ tema: { primary: "#000001" } })],
          [version({ tema: { primary: "#000002", accent: "#000003" } })],
          [version({ tema: { secondary: "#000004", accent: "#000005", "on-primary": "#000006" } })],
        ]),
      );
      expect(r?.tema).toEqual({
        primary: "#000001",
        accent: "#000003",
        secondary: "#000004",
        "on-primary": "#000006",
      });
    });

    it("lo que ningún eslabón define queda sin definir (lo pinta el tema neutro de la puerta)", () => {
      const r = decidirConfiguracionPublica(
        datos([[version({ tema: { primary: "#000001" } })], [version({ tema: {} })]]),
      );
      expect(r?.tema).toEqual({ primary: "#000001" });
    });

    it("un tema vacío en toda la cadena es un tema vacío, no un error", () => {
      expect(decidirConfiguracionPublica(datos([[version({ tema: {} })]]))?.tema).toEqual({});
    });

    it("un eslabón sin versión vigente no aporta nada, pero no corta la herencia", () => {
      const abuelo = [version({ tema: { secondary: "#000004" } })];
      const r = decidirConfiguracionPublica(
        datos([[version({ tema: { primary: "#000001" } })], [], abuelo]),
      );
      expect(r?.tema).toEqual({ primary: "#000001", secondary: "#000004" });
    });

    it("el tema de un ancestro sin versión vigente (solo programada) no se hereda", () => {
      const padre = [version({ tema: { accent: "#000009" }, vigenteDesde: DESPUES })];
      const r = decidirConfiguracionPublica(
        datos([[version({ tema: { primary: "#000001" } })], padre]),
      );
      expect(r?.tema).toEqual({ primary: "#000001" });
    });

    it("el tema sale con los tokens en el orden de la lista cerrada", () => {
      const r = decidirConfiguracionPublica(
        datos([[version({ tema: { accent: "#000003", primary: "#000001" } })]]),
      );
      expect(Object.keys(r?.tema ?? {})).toEqual(["primary", "accent"]);
    });
  });

  describe("un tema inválido en cualquier eslabón deja el tema NEUTRO (nunca el de otra marca)", () => {
    const validos = [version({ tema: TEMA })];
    const invalidos: [string, unknown][] = [
      ["un color de tres dígitos", { primary: "#fff" }],
      ["un color en mayúsculas", { primary: "#AABBCC" }],
      ["un color con nombre", { primary: "red" }],
      ["un valor que no es texto", { primary: 123 }],
      ["un valor nulo", { primary: null }],
      ["una clave fuera de la lista cerrada", { fondo: "#112233" }],
      ["CSS libre", { primary: "url(javascript:alert(1))" }],
      ["un valor válido y otro inválido", { primary: "#112233", accent: "azul" }],
      ["null", null],
      ["una lista", ["#112233"]],
      ["una lista vacía", []],
      ["un texto", "#112233"],
      ["un número", 7],
      ["un booleano", true],
      ["undefined", undefined],
    ];

    it.each(invalidos)("propio con %s: tema vacío aunque el padre sea válido", (_m, tema) => {
      const r = decidirConfiguracionPublica(datos([[version({ tema })], validos]));
      expect(r?.tema).toEqual({});
      expect(r?.nombre).toBe("Mi Calendario");
    });

    it.each(invalidos)(
      "de un ancestro con %s: tema vacío aunque el propio sea válido",
      (_m, tema) => {
        const r = decidirConfiguracionPublica(datos([[version()], [version({ tema })]]));
        expect(r?.tema).toEqual({});
      },
    );

    it("del abuelo (tercer eslabón): también deja el tema vacío", () => {
      const r = decidirConfiguracionPublica(
        datos([[version()], [version()], [version({ tema: { primary: "x" } })]]),
      );
      expect(r?.tema).toEqual({});
    });

    it("un tema inválido NO impide servir: sigue el nombre y el host canónico", () => {
      const r = decidirConfiguracionPublica(datos([[version({ tema: { primary: "x" } })]]));
      expect(r).toEqual({
        nombre: "Mi Calendario",
        tema: {},
        hostCanonico: "app.micalendario.test",
      });
    });

    it("la clave `__proto__` no pasa por la lista cerrada", () => {
      const tema: unknown = JSON.parse('{"__proto__": {"primary": "#112233"}}');
      expect(decidirConfiguracionPublica(datos([[version({ tema })]]))?.tema).toEqual({});
    });

    it("un tema vacío de un eslabón y uno inválido de otro: el inválido manda", () => {
      const r = decidirConfiguracionPublica(
        datos([[version({ tema: {} })], [version({ tema: { primary: "x" } })]]),
      );
      expect(r?.tema).toEqual({});
    });
  });
});
