import { describe, expect, it } from "vitest";
import type { VersionesVigentes } from "./catalogos";
import {
  LARGO_MAXIMO_DEL_CORREO,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CONTACTO,
  LARGO_MAXIMO_DEL_NOMBRE_DEL_NEGOCIO,
  validarFormulario,
  type CampoDeFormulario,
  type EntradaDeFormulario,
  type SolicitudValidada,
} from "./formulario";

const VIGENTES: VersionesVigentes = {
  terminos: ["2026-10-13", "2026-10-20"],
  privacidad: ["2026-10-13.1"],
  avisoDeMedicion: ["2026-11-01"],
};

const BASE: EntradaDeFormulario = {
  nombreContacto: "Ana Pérez",
  correo: "ana@cafe.com.ar",
  nombreNegocio: "Café Central",
  rubro: "cafeteria",
  provincia: "AR-B",
  telefono: "",
  cuit: "",
  aceptaTerminosYPrivacidad: true,
  versionDeTerminos: "2026-10-13",
  versionDePrivacidad: "2026-10-13.1",
  medicionConsentida: false,
  versionDeAvisoDeMedicion: "",
  idDeMedicion: "",
  atribucion: {},
};

const con = (cambios: Partial<EntradaDeFormulario>): EntradaDeFormulario => ({
  ...BASE,
  ...cambios,
});
const validar = (cambios: Partial<EntradaDeFormulario>) =>
  validarFormulario(con(cambios), VIGENTES);
const aceptada = (cambios: Partial<EntradaDeFormulario>): SolicitudValidada => {
  const r = validar(cambios);
  if (!r.ok) throw new Error(`se esperaba aceptada: ${JSON.stringify(r.error)}`);
  return r.valor;
};
const rechazadaPor = (cambios: Partial<EntradaDeFormulario>) => {
  const r = validar(cambios);
  return r.ok ? "ACEPTADA" : r.error;
};
const camposInvalidos = (cambios: Partial<EntradaDeFormulario>): readonly CampoDeFormulario[] => {
  const r = validar(cambios);
  if (r.ok || r.error.tipo !== "FORMA_INVALIDA") throw new Error("se esperaba FORMA_INVALIDA");
  return r.error.campos;
};

describe("validarFormulario: lo que se acepta", () => {
  it("un formulario completo y bien llenado se acepta tal cual, con los opcionales vacíos en null", () => {
    expect(validarFormulario(BASE, VIGENTES)).toEqual({
      ok: true,
      valor: {
        nombreContacto: "Ana Pérez",
        correo: "ana@cafe.com.ar",
        nombreNegocio: "Café Central",
        rubro: "cafeteria",
        provincia: "AR-B",
        telefono: null,
        cuit: null,
        versionDeTerminos: "2026-10-13",
        versionDePrivacidad: "2026-10-13.1",
        medicionConsentida: false,
        versionDeAvisoDeMedicion: null,
        idDeMedicion: null,
        atribucion: {},
      },
    });
  });

  it("con todos los opcionales: teléfono sin separadores, CUIT sin guiones, provincia y campaña", () => {
    const r = aceptada({
      telefono: "+54 9 (11) 1234-5678",
      cuit: "30-70308853-4",
      provincia: "AR-C",
      atribucion: { utm_source: "meta", utm_campaign: "Promo Verano" },
    });
    expect(r).toMatchObject({
      telefono: "+5491112345678",
      cuit: "30703088534",
      provincia: "AR-C",
      atribucion: { utm_source: "meta", utm_campaign: "Promo-Verano" },
    });
  });

  it("cualquier versión vigente sirve, no solo la primera", () => {
    expect(aceptada({ versionDeTerminos: "2026-10-20" }).versionDeTerminos).toBe("2026-10-20");
  });
});

describe("validarFormulario: páginas vencidas (precedencia sobre los campos)", () => {
  it("una versión de términos o de privacidad que no está vigente es PAGINA_VENCIDA", () => {
    expect(rechazadaPor({ versionDeTerminos: "2026-01-01" })).toEqual({ tipo: "PAGINA_VENCIDA" });
    expect(rechazadaPor({ versionDePrivacidad: "2026-10-13" })).toEqual({ tipo: "PAGINA_VENCIDA" });
    expect(rechazadaPor({ versionDeTerminos: "" })).toEqual({ tipo: "PAGINA_VENCIDA" });
    expect(rechazadaPor({ versionDePrivacidad: "" })).toEqual({ tipo: "PAGINA_VENCIDA" });
  });

  it("la versión se compara exacta: ni con espacios ni con otra capitalización ni cambiada de lista", () => {
    expect(rechazadaPor({ versionDeTerminos: " 2026-10-13" })).toEqual({ tipo: "PAGINA_VENCIDA" });
    expect(rechazadaPor({ versionDeTerminos: "2026-10-13 " })).toEqual({ tipo: "PAGINA_VENCIDA" });
    // la versión de privacidad no sirve como versión de términos, ni al revés
    expect(rechazadaPor({ versionDeTerminos: "2026-10-13.1" })).toEqual({ tipo: "PAGINA_VENCIDA" });
    expect(rechazadaPor({ versionDePrivacidad: "2026-10-20" })).toEqual({ tipo: "PAGINA_VENCIDA" });
  });

  it("con las listas vacías (hasta que haya textos legales) todo envío da PAGINA_VENCIDA", () => {
    const vacias: VersionesVigentes = { terminos: [], privacidad: [], avisoDeMedicion: [] };
    expect(validarFormulario(BASE, vacias)).toEqual({
      ok: false,
      error: { tipo: "PAGINA_VENCIDA" },
    });
  });

  it("gana sobre los errores de campo: con la página vieja no se marcan campos", () => {
    expect(
      rechazadaPor({
        versionDeTerminos: "2020-01-01",
        correo: "no",
        rubro: "x",
        nombreContacto: "",
      }),
    ).toEqual({ tipo: "PAGINA_VENCIDA" });
  });

  it("con consentimiento de medición, la versión del aviso tiene que estar vigente", () => {
    expect(rechazadaPor({ medicionConsentida: true, versionDeAvisoDeMedicion: "" })).toEqual({
      tipo: "PAGINA_VENCIDA",
    });
    expect(
      rechazadaPor({ medicionConsentida: true, versionDeAvisoDeMedicion: "2026-10-13" }),
    ).toEqual({ tipo: "PAGINA_VENCIDA" });
    expect(rechazadaPor({ medicionConsentida: true, versionDeAvisoDeMedicion: "2026-11-01" })).toBe(
      "ACEPTADA",
    );
  });

  it("sin consentimiento, la versión del aviso no importa (ni se guarda)", () => {
    expect(
      aceptada({ medicionConsentida: false, versionDeAvisoDeMedicion: "cualquier cosa" })
        .versionDeAvisoDeMedicion,
    ).toBeNull();
  });
});

describe("validarFormulario: los campos, todos juntos y en el orden del formulario", () => {
  it("devuelve TODOS los que fallan, en el orden: contacto, correo, negocio, rubro, provincia, teléfono, CUIT, términos", () => {
    expect(
      camposInvalidos({
        nombreContacto: "",
        correo: "no",
        nombreNegocio: "",
        rubro: "otra cosa",
        provincia: "AR-I",
        telefono: "123",
        cuit: "11111111111",
        aceptaTerminosYPrivacidad: false,
      }),
    ).toEqual([
      "nombreContacto",
      "correo",
      "nombreNegocio",
      "rubro",
      "provincia",
      "telefono",
      "cuit",
      "aceptaTerminosYPrivacidad",
    ]);
  });

  it.each<[string, Partial<EntradaDeFormulario>, CampoDeFormulario]>([
    ["nombre vacío", { nombreContacto: "" }, "nombreContacto"],
    ["correo inválido", { correo: "ana" }, "correo"],
    ["negocio vacío", { nombreNegocio: "" }, "nombreNegocio"],
    ["rubro desconocido", { rubro: "ferreteria" }, "rubro"],
    ["provincia desconocida", { provincia: "AR-I" }, "provincia"],
    ["teléfono corto", { telefono: "1234567" }, "telefono"],
    ["CUIT con dígito verificador malo", { cuit: "30703088535" }, "cuit"],
    ["sin aceptar términos", { aceptaTerminosYPrivacidad: false }, "aceptaTerminosYPrivacidad"],
  ])("un solo campo mal (%s) marca solo ese campo", (_nombre, cambios, campo) => {
    expect(rechazadaPor(cambios)).toEqual({ tipo: "FORMA_INVALIDA", campos: [campo] });
  });

  it("el rubro se compara exacto: ni mayúsculas ni espacios", () => {
    for (const rubro of ["Cafeteria", " cafeteria", "cafeteria ", "", "CAFETERIA"]) {
      expect(camposInvalidos({ rubro }), JSON.stringify(rubro)).toEqual(["rubro"]);
    }
    for (const rubro of [
      "panaderia",
      "restaurante",
      "bar",
      "heladeria",
      "almacen_o_comercio",
      "hoteleria",
      "otro",
    ]) {
      expect(aceptada({ rubro }).rubro).toBe(rubro);
    }
  });
});

describe("validarFormulario: nombres (texto visible de una línea)", () => {
  it("recorta los bordes, une los espacios repetidos y normaliza a NFC", () => {
    expect(aceptada({ nombreContacto: "  Ana   María \t".trimEnd() }).nombreContacto).toBe(
      "Ana María",
    );
    expect(aceptada({ nombreContacto: "Ana  María" }).nombreContacto).toBe("Ana María");
    expect(aceptada({ nombreContacto: "Ana María" }).nombreContacto).toBe("Ana María");
    // «e» + acento combinado pasa a la «é» de una pieza
    expect(aceptada({ nombreContacto: "José" }).nombreContacto).toBe("José");
    expect(aceptada({ nombreContacto: " Ana " }).nombreContacto).toBe("Ana");
    expect(aceptada({ nombreNegocio: "  Café   Central " }).nombreNegocio).toBe("Café Central");
  });

  it("el recorte saca también saltos de línea y tabulaciones de los bordes, pero no los del medio", () => {
    expect(aceptada({ nombreContacto: "Ana\n" }).nombreContacto).toBe("Ana");
    expect(aceptada({ nombreContacto: "\tAna" }).nombreContacto).toBe("Ana");
    expect(camposInvalidos({ nombreContacto: "Ana\nPérez" })).toEqual(["nombreContacto"]);
    expect(camposInvalidos({ nombreContacto: "Ana\tPérez" })).toEqual(["nombreContacto"]);
  });

  it("vacío o solo espacios no sirve", () => {
    for (const vacio of ["", " ", "   ", " ", "\n"]) {
      expect(camposInvalidos({ nombreContacto: vacio }), JSON.stringify(vacio)).toEqual([
        "nombreContacto",
      ]);
      expect(camposInvalidos({ nombreNegocio: vacio }), JSON.stringify(vacio)).toEqual([
        "nombreNegocio",
      ]);
    }
  });

  it("un solo carácter alcanza", () => {
    expect(aceptada({ nombreContacto: "A" }).nombreContacto).toBe("A");
    expect(aceptada({ nombreNegocio: "Ñ" }).nombreNegocio).toBe("Ñ");
  });

  it("el largo es 80 para el contacto y 100 para el negocio, contado en caracteres", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_CONTACTO).toBe(80);
    expect(LARGO_MAXIMO_DEL_NOMBRE_DEL_NEGOCIO).toBe(100);
    expect(aceptada({ nombreContacto: "a".repeat(80) }).nombreContacto).toHaveLength(80);
    expect(camposInvalidos({ nombreContacto: "a".repeat(81) })).toEqual(["nombreContacto"]);
    expect(aceptada({ nombreNegocio: "a".repeat(100) }).nombreNegocio).toHaveLength(100);
    expect(camposInvalidos({ nombreNegocio: "a".repeat(101) })).toEqual(["nombreNegocio"]);
    // el contacto no puede ser tan largo como el negocio
    expect(camposInvalidos({ nombreContacto: "a".repeat(100) })).toEqual(["nombreContacto"]);
  });

  it("un emoji cuenta como un carácter (como char_length de la base), no como dos", () => {
    const ochenta = "😀".repeat(80);
    expect(ochenta.length).toBe(160);
    expect(aceptada({ nombreContacto: ochenta }).nombreContacto).toBe(ochenta);
    expect(camposInvalidos({ nombreContacto: "😀".repeat(81) })).toEqual(["nombreContacto"]);
  });

  it("los caracteres de control, de formato, separadores de línea y sustitutos sueltos se rechazan", () => {
    const prohibidos = [
      "\u0000",
      "\u0007",
      "\u001b",
      "\u007f",
      "\u0085",
      "​", // espacio de ancho cero (formato)
      "‎", // marca de izquierda a derecha
      "‮", // inversión del sentido de lectura
      "⁦",
      "﻿",
      " ",
      " ",
      "\ud800", // sustituto suelto
      "\udfff",
      "", // uso privado
      "͸", // sin asignar
    ];
    for (const c of prohibidos) {
      const texto = `Ana${c}Pérez`;
      expect(camposInvalidos({ nombreContacto: texto }), JSON.stringify(c)).toEqual([
        "nombreContacto",
      ]);
      expect(camposInvalidos({ nombreNegocio: texto }), JSON.stringify(c)).toEqual([
        "nombreNegocio",
      ]);
    }
  });

  it("letras acentuadas, eñes, apóstrofos, guiones, puntos, números y símbolos comunes sí", () => {
    for (const nombre of [
      "Ñandú O'Brien-Pérez",
      "Café & Té S.R.L.",
      "Panadería 25 de Mayo",
      "李雷",
      "Zoë",
    ]) {
      expect(aceptada({ nombreNegocio: nombre }).nombreNegocio).toBe(nombre);
    }
  });
});

describe("validarFormulario: correo", () => {
  it("se pasa a minúsculas y se recortan los bordes", () => {
    expect(aceptada({ correo: "  Ana.Perez@Cafe.COM.ar " }).correo).toBe("ana.perez@cafe.com.ar");
  });

  it.each([
    "ana@cafe.com",
    "a@b.co",
    "ana.perez@cafe.com.ar",
    "ana+promo@gmail.com",
    "ana_perez-2@sub.dominio.ejemplo.org",
    "1@2.ab",
    "ana@xn--caf-dma.com",
    "ana@a-b.co",
    "a@b-c.d-e",
    // la última etiqueta solo se rechaza si es TODA numérica (una dirección tipo IP), no si lleva algún dígito
    "ana@cafe.co2",
    "ana@cafe.2co",
    "ana@cafe.a1b",
  ])("acepta %s", (correo) => {
    expect(aceptada({ correo }).correo).toBe(correo);
  });

  it.each([
    "",
    "ana",
    "@cafe.com",
    "ana@",
    "ana@cafe",
    "ana@@cafe.com",
    "ana@cafe@com.ar",
    "a b@cafe.com",
    "ana@ca fe.com",
    "ana@cafe.com ana@x.com",
    "ana@cafe.com\nbcc:x@y.com",
    "ana@cafe.com\r\nbcc: x@y.com",
    "ana\u0000@cafe.com",
    ".ana@cafe.com",
    "ana.@cafe.com",
    "an..a@cafe.com",
    "ana@.cafe.com",
    "ana@cafe..com",
    "ana@cafe.com.",
    "ana@-cafe.com",
    "ana@cafe-.com",
    "ana@cafe.c_m",
    "ana@192.168.0.1",
    "ana@cafe.123",
    "ana@[192.168.0.1]",
    "ana<x>@cafe.com",
    '"ana"@cafe.com',
    "ana,beto@cafe.com",
    "ana;beto@cafe.com",
    "ana(c)@cafe.com",
    "o'brien@cafe.com",
    "ana%x@cafe.com",
    "ana/x@cafe.com",
    "añana@cafe.com",
    "ana@café.com",
    "ana@cafe.com​",
    "ana@Kafe.com", // signo Kelvin: en minúscula sería una «k» ASCII
    "Kana@cafe.com",
    "ana@CAFE.ＣＯＭ", // letras de ancho completo
  ])("rechaza %j", (correo) => {
    expect(camposInvalidos({ correo }), JSON.stringify(correo)).toEqual(["correo"]);
  });

  it("el largo: 254 caracteres entra, 255 no; la parte local 64 entra, 65 no", () => {
    expect(LARGO_MAXIMO_DEL_CORREO).toBe(254);
    // 64 + 1 + 189 = 254: dominio de etiquetas de 63, 63 y 59 más «.com»
    const dominioDe254 = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    expect(dominioDe254).toHaveLength(189);
    const de254 = `${"a".repeat(64)}@${dominioDe254}`;
    expect(de254).toHaveLength(254);
    expect(aceptada({ correo: de254 }).correo).toBe(de254);
    const de255 = `${"a".repeat(64)}@${dominioDe254}m`;
    expect(de255).toHaveLength(255);
    expect(camposInvalidos({ correo: de255 })).toEqual(["correo"]);
    // la parte local pasa de 64 con un dominio corto
    expect(aceptada({ correo: `${"a".repeat(64)}@x.com` }).correo).toHaveLength(64 + 6);
    expect(camposInvalidos({ correo: `${"a".repeat(65)}@x.com` })).toEqual(["correo"]);
  });

  it("una etiqueta del dominio: 63 caracteres entra, 64 no", () => {
    expect(aceptada({ correo: `a@${"b".repeat(63)}.com` }).correo).toBe(`a@${"b".repeat(63)}.com`);
    expect(camposInvalidos({ correo: `a@${"b".repeat(64)}.com` })).toEqual(["correo"]);
  });

  it("dos etiquetas alcanzan; una sola no", () => {
    expect(aceptada({ correo: "a@b.cd" }).correo).toBe("a@b.cd");
    expect(camposInvalidos({ correo: "a@bcd" })).toEqual(["correo"]);
  });
});

describe("validarFormulario: teléfono", () => {
  it("vacío o solo espacios es «no lo dio»", () => {
    expect(aceptada({ telefono: "" }).telefono).toBeNull();
    expect(aceptada({ telefono: "   " }).telefono).toBeNull();
  });

  it("saca espacios, paréntesis, puntos y guiones, y conserva el signo más inicial", () => {
    expect(aceptada({ telefono: "011 4444-5555" }).telefono).toBe("01144445555");
    expect(aceptada({ telefono: "(011) 4444.5555" }).telefono).toBe("01144445555");
    expect(aceptada({ telefono: " +54-9-11-1234-5678 " }).telefono).toBe("+5491112345678");
    expect(aceptada({ telefono: "1234 5678" }).telefono).toBe("12345678");
  });

  it("de 8 a 15 dígitos", () => {
    expect(aceptada({ telefono: "12345678" }).telefono).toBe("12345678");
    expect(aceptada({ telefono: "123456789012345" }).telefono).toBe("123456789012345");
    expect(aceptada({ telefono: "+123456789012345" }).telefono).toBe("+123456789012345");
    expect(camposInvalidos({ telefono: "1234567" })).toEqual(["telefono"]);
    expect(camposInvalidos({ telefono: "+1234567" })).toEqual(["telefono"]);
    expect(camposInvalidos({ telefono: "1234567890123456" })).toEqual(["telefono"]);
  });

  it("rechaza letras, el más en el medio o repetido, y caracteres raros", () => {
    for (const telefono of [
      "12345678a",
      "abc",
      "12+345678",
      "++12345678",
      "1234-5678x",
      "12345678;",
      "１２３４５６７８",
    ]) {
      expect(camposInvalidos({ telefono }), JSON.stringify(telefono)).toEqual(["telefono"]);
    }
  });
});

describe("validarFormulario: CUIT", () => {
  it("vacío es «no lo dio»; con guiones o sin ellos se guarda solo con dígitos", () => {
    expect(aceptada({ cuit: "" }).cuit).toBeNull();
    expect(aceptada({ cuit: "  " }).cuit).toBeNull();
    expect(aceptada({ cuit: "30703088534" }).cuit).toBe("30703088534");
    expect(aceptada({ cuit: "30-70308853-4" }).cuit).toBe("30703088534");
    expect(aceptada({ cuit: " 30-70308853-4 " }).cuit).toBe("30703088534");
  });

  it("rechaza el dígito verificador malo, el largo malo y las letras", () => {
    for (const cuit of [
      "30703088535",
      "3070308853",
      "307030885344",
      "abcdefghijk",
      "30 70308853 4",
      "30-7030885-34",
    ]) {
      expect(camposInvalidos({ cuit }), cuit).toEqual(["cuit"]);
    }
  });
});

describe("validarFormulario: provincia", () => {
  it("vacía es «no la dio»; las 24 jurisdicciones valen tal cual", () => {
    expect(aceptada({ provincia: "" }).provincia).toBeNull();
    expect(aceptada({ provincia: "  " }).provincia).toBeNull();
    expect(aceptada({ provincia: " AR-X " }).provincia).toBe("AR-X");
    for (const codigo of [
      "AR-A",
      "AR-B",
      "AR-C",
      "AR-D",
      "AR-E",
      "AR-F",
      "AR-G",
      "AR-H",
      "AR-J",
      "AR-K",
      "AR-L",
      "AR-M",
      "AR-N",
      "AR-P",
      "AR-Q",
      "AR-R",
      "AR-S",
      "AR-T",
      "AR-U",
      "AR-V",
      "AR-W",
      "AR-X",
      "AR-Y",
      "AR-Z",
    ]) {
      expect(aceptada({ provincia: codigo }).provincia, codigo).toBe(codigo);
    }
  });

  it("rechaza lo que no es una jurisdicción: la I, el nombre, otro país, minúsculas", () => {
    for (const provincia of ["AR-I", "AR-O", "Buenos Aires", "ar-b", "CL-RM", "AR-BA", "AR"]) {
      expect(camposInvalidos({ provincia }), provincia).toEqual(["provincia"]);
    }
  });
});

describe("validarFormulario: términos y privacidad", () => {
  it("la casilla tiene que estar marcada", () => {
    expect(camposInvalidos({ aceptaTerminosYPrivacidad: false })).toEqual([
      "aceptaTerminosYPrivacidad",
    ]);
  });
});

describe("validarFormulario: medición y atribución", () => {
  const AVISO = { medicionConsentida: true, versionDeAvisoDeMedicion: "2026-11-01" } as const;
  const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

  it("sin consentimiento: ni versión del aviso, ni identificador de medición, ni fbclid; los utm sí", () => {
    const r = aceptada({
      idDeMedicion: ID,
      versionDeAvisoDeMedicion: "2026-11-01",
      atribucion: { utm_source: "meta", fbclid: "IwAR0abc" },
    });
    expect(r).toMatchObject({
      medicionConsentida: false,
      versionDeAvisoDeMedicion: null,
      idDeMedicion: null,
      atribucion: { utm_source: "meta" },
    });
    expect(r.atribucion).not.toHaveProperty("fbclid");
  });

  it("con consentimiento: guarda la versión del aviso, el identificador y el fbclid", () => {
    const r = aceptada({
      ...AVISO,
      idDeMedicion: ID,
      atribucion: { utm_source: "meta", fbclid: "IwAR0abc" },
    });
    expect(r).toMatchObject({
      medicionConsentida: true,
      versionDeAvisoDeMedicion: "2026-11-01",
      idDeMedicion: ID,
      atribucion: { utm_source: "meta", fbclid: "IwAR0abc" },
    });
  });

  it("el identificador se pasa a minúsculas y se recorta; si no es un uuid se descarta sin bloquear el envío", () => {
    expect(aceptada({ ...AVISO, idDeMedicion: `  ${ID.toUpperCase()} ` }).idDeMedicion).toBe(ID);
    for (const id of [
      "",
      "no-es-un-uuid",
      `${ID}0`,
      `x${ID}`,
      `0${ID}`,
      ID.slice(1),
      ID.replaceAll("-", ""),
      `${ID.slice(0, 35)}g`,
      "0a1b2c3d-4e5f-4a6b-8c7d\n9e0f1a2b3c4d",
    ]) {
      expect(aceptada({ ...AVISO, idDeMedicion: id }).idDeMedicion, JSON.stringify(id)).toBeNull();
    }
  });

  it("una atribución rota no bloquea el envío: se limpia o se descarta", () => {
    const r = aceptada({ atribucion: { utm_source: "<script>", utm_medium: "", fbclid: "x" } });
    expect(r.atribucion).toEqual({ utm_source: "script" });
  });
});
