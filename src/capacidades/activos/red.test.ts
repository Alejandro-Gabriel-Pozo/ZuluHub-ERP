import { describe, expect, it } from "vitest";
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

/**
 * C-17/C-18 (parte pura): la guarda de IP de S2. Los límites de cada rango se calculan con aritmética
 * propia (`test/utilidades/rangos-de-red.ts`), no con el código que se prueba, y a mano se fijan los
 * casos que el spec nombra y los vecinos «justo afuera» que SÍ se permiten.
 */

describe("direccionDeRedPermitida: IPv4, rango por rango", () => {
  it.each(RANGOS_V4_PROHIBIDOS)("%s: primera, última y una del medio quedan prohibidas", (cidr) => {
    const { primera, ultima } = limitesV4(cidr);
    const medio = Math.floor((primera + ultima) / 2);
    for (const n of [primera, medio, ultima]) {
      expect(direccionDeRedPermitida(numeroAIpv4(n)), numeroAIpv4(n)).toBe(false);
    }
  });

  it.each(RANGOS_V4_PROHIBIDOS)(
    "%s: los vecinos de afuera se deciden por el rango que los contenga",
    (cidr) => {
      const { primera, ultima } = limitesV4(cidr);
      for (const n of [primera - 1, ultima + 1]) {
        if (n < 0 || n > 0xffffffff) continue;
        const ip = numeroAIpv4(n);
        expect(direccionDeRedPermitida(ip), ip).toBe(oraculoPermitida(ip));
      }
    },
  );

  it.each([
    "1.0.0.0",
    "9.255.255.255",
    "11.0.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "126.255.255.255",
    "128.0.0.0",
    "169.253.255.255",
    "169.255.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "191.255.255.255",
    "192.0.1.0",
    "192.0.1.255",
    "192.0.3.0",
    "192.88.98.255",
    "192.88.100.0",
    "192.167.255.255",
    "192.169.0.0",
    "198.17.255.255",
    "198.20.0.0",
    "198.51.99.255",
    "198.51.101.0",
    "203.0.112.255",
    "203.0.114.0",
    "223.255.255.255",
    "8.8.8.8",
    "1.1.1.1",
    "104.16.0.1",
    "151.101.1.1",
  ])("%s está justo afuera de lo prohibido o es pública: se permite", (ip) => {
    expect(direccionDeRedPermitida(ip)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.0",
    "255.255.255.255",
  ])("%s, nombrada por el spec o en el borde, se prohíbe", (ip) => {
    expect(direccionDeRedPermitida(ip)).toBe(false);
  });
});

describe("direccionDeRedPermitida: IPv6", () => {
  it.each(RANGOS_V6_ESPECIALES_EN_UNICAST)(
    "%s (dentro de 2000::/3): primera, última y del medio, prohibidas",
    (cidr) => {
      const { primera, ultima } = limitesV6(cidr);
      for (const n of [primera, (primera + ultima) / 2n, ultima]) {
        expect(direccionDeRedPermitida(bigintAIpv6(n)), bigintAIpv6(n)).toBe(false);
      }
    },
  );

  it.each(RANGOS_V6_ESPECIALES_EN_UNICAST)("%s: los vecinos de afuera SÍ se permiten", (cidr) => {
    const { primera, ultima } = limitesV6(cidr);
    for (const n of [primera - 1n, ultima + 1n]) {
      expect(direccionDeRedPermitida(bigintAIpv6(n)), bigintAIpv6(n)).toBe(true);
    }
  });

  it.each(RANGOS_V6_FUERA_DE_UNICAST)(
    "%s (fuera de 2000::/3): primera, última y del medio, prohibidas",
    (cidr) => {
      const { primera, ultima } = limitesV6(cidr);
      for (const n of [primera, (primera + ultima) / 2n, ultima]) {
        expect(direccionDeRedPermitida(bigintAIpv6(n)), bigintAIpv6(n)).toBe(false);
      }
    },
  );

  it("2000::/3: la primera y la última de las globales se permiten; las dos de afuera, no", () => {
    expect(direccionDeRedPermitida("2000::")).toBe(true);
    expect(direccionDeRedPermitida("2000:0:0:0:0:0:0:1")).toBe(true);
    expect(direccionDeRedPermitida("3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(direccionDeRedPermitida("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(false);
    expect(direccionDeRedPermitida("4000::")).toBe(false);
  });

  it.each([
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("%s, nombrada por el spec, se prohíbe", (ip) => {
    expect(direccionDeRedPermitida(ip)).toBe(false);
  });

  it.each([
    "2606:4700::1111",
    "2606:4700:0:0:0:0:0:1111",
    "2606:4700:0000:0000:0000:0000:0000:1111",
    "2606:4700::0.0.17.17",
    "2606:4700:1:2:3:4:5::",
    "2a00:1450:4001:81b::200e",
    "2A00:1450:4001:81B::200E",
    "2001:4860:4860::8888",
    "2620:fe::fe",
  ])("%s es una pública válida: se permite", (ip) => {
    expect(direccionDeRedPermitida(ip)).toBe(true);
  });

  it("IPv4 mapeada, compatible, NAT64, 6to4 y Teredo: se prohíben con CUALQUIER IPv4 adentro, en toda grafía", () => {
    for (const n of [0, 0x7f000001, 0x0a000001, 0x08080808, 0xa9fea9fe, 0xffffffff]) {
      for (const forma of ipv6ConIpv4Adentro(n)) {
        expect(direccionDeRedPermitida(forma), forma).toBe(false);
      }
    }
  });
});

describe("direccionDeRedPermitida: formas ambiguas o mal formadas (todas false)", () => {
  it("las grafías no canónicas de 127.0.0.1, 10.0.0.1 y de una pública como 8.8.8.8 se rechazan", () => {
    for (const n of [0x7f000001, 0x0a000001, 0xa9fea9fe, 0x08080808]) {
      for (const forma of escrituraEquivalenteV4(n)) {
        expect(direccionDeRedPermitida(forma), JSON.stringify(forma)).toBe(false);
      }
    }
    // Las más conocidas, escritas a mano.
    for (const ip of [
      "0177.0.0.1",
      "0x7f.1",
      "2130706433",
      "127.1",
      "127.000.000.001",
      "017700000001",
      "0x7f000001",
    ]) {
      expect(direccionDeRedPermitida(ip), ip).toBe(false);
    }
  });

  it.each([
    "",
    " ",
    "1.2.3",
    "1.2.3.4.5",
    "1.2.3.256",
    "256.1.1.1",
    "1.2.3.-4",
    "1.2.3.4/32",
    "1.2.3.4:80",
    "08.8.8.8",
    "8.8.8.08",
    "8.8.8.8\0",
    "\u{FF18}.\u{FF18}.\u{FF18}.\u{FF18}",
    "٨.٨.٨.٨",
    "+8.8.8.8",
    "8..8.8",
    ".8.8.8.8",
    "8.8.8.",
    "1e1.1.1.1",
    "1.2.3.4a",
    "a.b.c.d",
    "localhost",
    "evil.com",
    ":::",
    "::::",
    "1::2::3",
    "2606:4700:::1",
    "2606:4700:0:0:0:0:0:0:1",
    "2606:4700:0:0:0:0:0",
    "1:2:3:4:5:6:7:8::",
    "::1:2:3:4:5:6:7:8",
    "g::",
    "12345::1",
    "2606:4700::1%eth0",
    "2606:4700::1%",
    "[2606:4700::1]",
    "2606:4700::1/64",
    "::1.2.3",
    "2606::1.2.3.4.5",
    "2606::1.2.3.4:5",
    "2606::01.2.3.4",
    "1.2.3.4::",
    "2606:1.2.3.4::1",
    ":2606::1",
    "2606::1:",
    "2606::1 ",
    " 2606::1",
    "2606:4700::١",
    "2606:4700::\u{FF11}",
    "İ::",
    "2606:4700::1\0",
  ])("%j se rechaza", (texto) => {
    expect(direccionDeRedPermitida(texto)).toBe(false);
  });

  it("el largo máximo es el de la IPv6 más larga (45): una más no se lee, ni siquiera si es válida", () => {
    const masLarga = "0000:0000:0000:0000:0000:ffff:255.255.255.255";
    expect(masLarga).toHaveLength(45);
    expect(direccionDeRedPermitida(masLarga)).toBe(false);
    expect(direccionDeRedPermitida(`2606:4700:0:0:0:0:0:1:${"0".repeat(20)}`)).toBe(false);
    // 45 caracteres de una pública con ceros a la izquierda: se lee y se permite.
    const publica45 = "2606:4700:0000:0000:0000:0000:0000:1111";
    expect(direccionDeRedPermitida(publica45)).toBe(true);
    expect(direccionDeRedPermitida(`${"0".repeat(5)}${publica45}`)).toBe(false);
  });

  it("un valor que no es texto se rechaza sin lanzar", () => {
    for (const x of [null, undefined, 2130706433, {}, []]) {
      expect(direccionDeRedPermitida(x as unknown as string)).toBe(false);
    }
  });

  it("textos enormes se rechazan en tiempo acotado", () => {
    const ataques = [
      ":".repeat(1_000_000),
      ".".repeat(1_000_000),
      "1.".repeat(500_000),
      "a:".repeat(500_000),
      "0".repeat(1_000_000),
    ];
    const desde = performance.now();
    for (const a of ataques) expect(direccionDeRedPermitida(a)).toBe(false);
    expect(performance.now() - desde).toBeLessThan(1_000);
  });
});
