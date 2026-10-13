import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  RANGOS_V4_PROHIBIDOS,
  RANGOS_V6_ESPECIALES_EN_UNICAST,
  RANGOS_V6_FUERA_DE_UNICAST,
  bigintAIpv6,
  escrituraEquivalenteV4,
  ipv6ConIpv4Adentro,
  limitesV4,
  limitesV6,
  numeroAIpv4,
  oraculoPermitida,
} from "../../../test/utilidades/rangos-de-red";
import { direccionDeRedPermitida } from "./red";

/** Propiedades de la guarda de IP: contra el oráculo independiente, sobre rangos, grafías y texto hostil. */

const MAXIMO_V4 = 0xffffffff;
const MAXIMO_V6 = (1n << 128n) - 1n;

const ipv4Cualquiera = fc.oneof(
  fc.integer({ min: 0, max: MAXIMO_V4 }),
  // Sesgo hacia los bordes de cada rango, donde se rompen los límites.
  fc
    .constantFrom(...RANGOS_V4_PROHIBIDOS)
    .chain((cidr) => {
      const { primera, ultima } = limitesV4(cidr);
      return fc.constantFrom(primera - 1, primera, primera + 1, ultima - 1, ultima, ultima + 1);
    })
    .filter((n) => n >= 0 && n <= MAXIMO_V4),
);

const ipv4Prohibida = fc.constantFrom(...RANGOS_V4_PROHIBIDOS).chain((cidr) => {
  const { primera, ultima } = limitesV4(cidr);
  return fc.integer({ min: primera, max: ultima });
});

/** 128 bits: al azar, o con un prefijo de rango especial (o de sus vecinos) y el resto al azar. */
const ipv6Cualquiera = fc.oneof(
  fc.bigInt({ min: 0n, max: MAXIMO_V6 }),
  fc
    .tuple(
      fc.constantFrom(
        ...RANGOS_V6_ESPECIALES_EN_UNICAST,
        ...RANGOS_V6_FUERA_DE_UNICAST,
        "2000::/3",
      ),
      fc.bigInt({ min: 0n, max: MAXIMO_V6 }),
      fc.constantFrom(-1n, 0n, 1n),
    )
    .map(([cidr, azar, vecino]) => {
      const { primera, ultima } = limitesV6(cidr);
      const dentro = primera + (azar % (ultima - primera + 1n));
      const n = vecino === 0n ? dentro : vecino < 0n ? primera - 1n : ultima + 1n;
      return n < 0n ? 0n : n > MAXIMO_V6 ? MAXIMO_V6 : n;
    }),
);

/** La misma IPv6 escrita de varias formas válidas: completa, con ceros, comprimida, en mayúsculas, con cola IPv4. */
function grafiasV6(n: bigint, eleccion: number): string {
  const grupos = bigintAIpv6(n).split(":");
  const relleno = grupos.map((g) => g.padStart(4, "0"));
  switch (eleccion % 5) {
    case 0:
      return grupos.join(":");
    case 1:
      return relleno.join(":");
    case 2:
      return relleno.join(":").toUpperCase();
    case 3: {
      const alta = Number.parseInt(grupos[6] ?? "0", 16);
      const baja = Number.parseInt(grupos[7] ?? "0", 16);
      return `${grupos.slice(0, 6).join(":")}:${numeroAIpv4(alta * 65536 + baja)}`;
    }
    default: {
      // Comprime la racha de ceros más larga (de largo al menos 1) con «::».
      let mejor = { desde: -1, largo: 0 };
      for (let i = 0; i < 8;) {
        if (grupos[i] !== "0") {
          i++;
          continue;
        }
        let j = i;
        while (j < 8 && grupos[j] === "0") j++;
        if (j - i > mejor.largo) mejor = { desde: i, largo: j - i };
        i = j;
      }
      if (mejor.largo === 0) return grupos.join(":");
      return `${grupos.slice(0, mejor.desde).join(":")}::${grupos.slice(mejor.desde + mejor.largo).join(":")}`;
    }
  }
}

describe("direccionDeRedPermitida: propiedades", () => {
  it("IPv4 canónica: decide igual que el oráculo (BlockList de Node con la lista del spec)", () => {
    fc.assert(
      fc.property(ipv4Cualquiera, (n) => {
        const ip = numeroAIpv4(n);
        expect(direccionDeRedPermitida(ip), ip).toBe(oraculoPermitida(ip));
      }),
    );
  });

  it("ninguna IPv4 dentro de un rango prohibido se permite, en ninguna forma de escribirla", () => {
    fc.assert(
      fc.property(ipv4Prohibida, (n) => {
        for (const forma of [
          numeroAIpv4(n),
          ...escrituraEquivalenteV4(n),
          ...ipv6ConIpv4Adentro(n),
        ]) {
          expect(direccionDeRedPermitida(forma), forma).toBe(false);
        }
      }),
    );
  });

  it("toda grafía no canónica de CUALQUIER IPv4 se rechaza (también las públicas: no hay ambigüedad)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAXIMO_V4 }), (n) => {
        for (const forma of [...escrituraEquivalenteV4(n), ...ipv6ConIpv4Adentro(n)]) {
          expect(direccionDeRedPermitida(forma), forma).toBe(false);
        }
      }),
    );
  });

  it("IPv6 en cualquier grafía válida: decide igual que el oráculo", () => {
    fc.assert(
      fc.property(ipv6Cualquiera, fc.nat(4), (n, eleccion) => {
        const ip = grafiasV6(n, eleccion);
        expect(direccionDeRedPermitida(ip), ip).toBe(oraculoPermitida(ip));
      }),
    );
  });

  it("una IPv6 dentro de un rango prohibido o fuera de 2000::/3 nunca se permite", () => {
    const prohibida = fc
      .tuple(
        fc.constantFrom(...RANGOS_V6_ESPECIALES_EN_UNICAST, ...RANGOS_V6_FUERA_DE_UNICAST),
        fc.bigInt({ min: 0n, max: MAXIMO_V6 }),
        fc.nat(4),
      )
      .map(([cidr, azar, eleccion]) => {
        const { primera, ultima } = limitesV6(cidr);
        return grafiasV6(primera + (azar % (ultima - primera + 1n)), eleccion);
      });
    fc.assert(
      fc.property(prohibida, (ip) => {
        expect(direccionDeRedPermitida(ip), ip).toBe(false);
      }),
    );
  });

  const publicas = ["8.8.8.8", "104.16.0.1", "2606:4700::1111", "2a00:1450:4001:81b::200e"];
  const alfabetoIp = "0123456789abcdefABCDEFxX:.%[]/\\ \t\n\0-+gG";

  it("nunca lanza, y si permite es porque es una IP canónica pública (texto arbitrario y mutado)", () => {
    const mutada = fc
      .tuple(
        fc.constantFrom(...publicas),
        fc.nat(60),
        fc.string({ unit: fc.constantFrom(...alfabetoIp), maxLength: 3 }),
        fc.nat(2),
      )
      .map(([ip, posicion, texto, modo]) => {
        const i = posicion % (ip.length + 1);
        if (modo === 0) return ip.slice(0, i) + texto + ip.slice(i);
        if (modo === 1) return ip.slice(0, i) + texto + ip.slice(i + 1);
        return ip.slice(0, i) + ip.slice(i + 1);
      });
    const textos = fc.oneof(
      fc.string({ maxLength: 60 }),
      fc.string({ unit: "binary", maxLength: 60 }),
      fc.string({ unit: fc.constantFrom(...alfabetoIp), maxLength: 50 }),
      mutada,
    );
    fc.assert(
      fc.property(textos, (texto) => {
        const permitido = direccionDeRedPermitida(texto);
        expect(typeof permitido).toBe("boolean");
        if (permitido) expect(oraculoPermitida(texto), JSON.stringify(texto)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("textos largos hostiles se resuelven en tiempo acotado", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...alfabetoIp), minLength: 10_000, maxLength: 50_000 }),
        (texto) => {
          const desde = performance.now();
          expect(direccionDeRedPermitida(texto)).toBe(false);
          expect(performance.now() - desde).toBeLessThan(200);
        },
      ),
      { numRuns: 20 },
    );
  });
});
