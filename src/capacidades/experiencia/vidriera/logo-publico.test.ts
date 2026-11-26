import { describe, expect, it, vi } from "vitest";
import type { PartesDeDireccion } from "../../activos/direccion-externa";
import { crearMemoriaDeLogos } from "../../activos/memoria-de-logos";
import type { ImagenesExternas } from "../../../puertos/imagenes-externas";
import type { VidrieraPublicada } from "../../../puertos/vidriera-publica";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { AlcanceDelHost } from "../puerta";
import {
  logoPublicoDeLaCarta,
  rutaDelLogoServido,
  versionDeLaRuta,
  type DependenciasDelLogoPublico,
} from "./logo-publico";

const HOST = { marcaId: "marca-1", duenio: { tipo: "MARCA" } } as unknown as AlcanceDelHost;
const PARTES: PartesDeDireccion = {
  proveedor: "CLOUDINARY",
  cuenta: "demo",
  idPublico: "logos/cafe",
  version: "1700000000",
  extension: "png",
};
const BYTES = new Uint8Array([1, 2, 3]);

const vidrieraConLogo = (
  logo: PartesDeDireccion | null,
  codigo = "cafe-1",
  cuentasDeImagen: readonly string[] = ["demo"],
): VidrieraPublicada =>
  ({ id: "v1", codigo, identidad: { logo }, cuentasDeImagen }) as unknown as VidrieraPublicada;

function armar(
  vidriera: VidrieraPublicada | null,
  traedor: ImagenesExternas["traerLogo"] = () => Promise.resolve(ok(BYTES)),
) {
  const porCodigo = vi.fn(() => Promise.resolve(vidriera));
  const traerLogo = vi.fn(traedor);
  const dependencias: DependenciasDelLogoPublico = {
    vidriera: { porCodigo },
    traedor: { traerLogo },
    memoria: crearMemoriaDeLogos(() => 0),
  };
  return { dependencias, porCodigo, traerLogo };
}

describe("versionDeLaRuta y rutaDelLogoServido", () => {
  it("quitan y ponen el sufijo .webp", () => {
    expect(versionDeLaRuta("1700000000.webp")).toBe("1700000000");
    expect(versionDeLaRuta("1700000000")).toBeNull();
    expect(versionDeLaRuta("1700000000.png")).toBeNull();
    expect(versionDeLaRuta(".webp")).toBe("");
    expect(rutaDelLogoServido("/cafe-1", "1700000000")).toBe("/cafe-1/logo/1700000000.webp");
    expect(rutaDelLogoServido("", "7")).toBe("/logo/7.webp");
  });
});

describe("logoPublicoDeLaCarta: lo que se sirve", () => {
  it("la versión guardada: pide el destino exacto (cuenta de la carta, transformación de logo) y entrega los bytes", async () => {
    const { dependencias, porCodigo, traerLogo } = armar(vidrieraConLogo(PARTES));
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBe(BYTES);
    expect(porCodigo).toHaveBeenCalledWith(HOST, "cafe-1");
    expect(traerLogo).toHaveBeenCalledTimes(1);
    expect(traerLogo.mock.calls[0]?.[0]).toMatchObject({
      host: "res.cloudinary.com",
      variante: "LOGO",
      url: "https://res.cloudinary.com/demo/image/upload/c_limit,w_240,h_240,f_webp,q_80/v1700000000/logos/cafe.png",
    });
  });

  it("la segunda visita sale de la memoria, no del tercero (la carta se vuelve a mirar siempre)", async () => {
    const { dependencias, porCodigo, traerLogo } = armar(vidrieraConLogo(PARTES));
    await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp");
    await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp");
    expect(traerLogo).toHaveBeenCalledTimes(1);
    expect(porCodigo).toHaveBeenCalledTimes(2);
  });

  it("20 visitas a la vez, una sola conexión saliente", async () => {
    const { dependencias, traerLogo } = armar(vidrieraConLogo(PARTES), async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ok(BYTES);
    });
    const todas = await Promise.all(
      Array.from({ length: 20 }, () =>
        logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp"),
      ),
    );
    expect(todas.every((b) => b === BYTES)).toBe(true);
    expect(traerLogo).toHaveBeenCalledTimes(1);
  });
});

describe("logoPublicoDeLaCarta: todo lo demás es la misma respuesta vacía", () => {
  it.each([
    ["sin el sufijo .webp", "1700000000"],
    ["con otra extensión", "1700000000.png"],
    ["vacío", ""],
  ])("un tramo %s no toca ni la carta", async (_n, tramo) => {
    const { dependencias, porCodigo, traerLogo } = armar(vidrieraConLogo(PARTES));
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", tramo)).toBeNull();
    expect(porCodigo).not.toHaveBeenCalled();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("una carta que no se sirve (otra marca, fuera de línea, sin plan): sin ir a internet", async () => {
    const { dependencias, traerLogo } = armar(null);
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it("la cuenta del logo no está entre las declaradas por la empresa de la carta (otra, retirada o ninguna): el mismo vacío y NINGÚN pedido saliente", async () => {
    for (const cuentas of [[], ["otra-cuenta"], ["demo2", "de-agencia"]]) {
      const { dependencias, traerLogo } = armar(vidrieraConLogo(PARTES, "cafe-1", cuentas));
      expect(
        await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp"),
        cuentas.join(","),
      ).toBeNull();
      expect(traerLogo).not.toHaveBeenCalled();
    }
    // Con la cuenta declarada entre otras, sí.
    const { dependencias, traerLogo } = armar(vidrieraConLogo(PARTES, "cafe-1", ["otra", "demo"]));
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBe(BYTES);
    expect(traerLogo).toHaveBeenCalledTimes(1);
  });

  it("una carta sin logo propio", async () => {
    const { dependencias, traerLogo } = armar(vidrieraConLogo(null));
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });

  it.each(["1699999999.webp", "1700000001.webp", "17000000000.webp", ".webp", "v1700000000.webp"])(
    "una versión vieja o inventada (%s) se corta ANTES de ir a internet",
    async (tramo) => {
      const { dependencias, traerLogo } = armar(vidrieraConLogo(PARTES));
      expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", tramo)).toBeNull();
      expect(traerLogo).not.toHaveBeenCalled();
    },
  );

  it("unas partes que ya no pasan la forma del proveedor (dato malo de la base)", async () => {
    const mala = { ...PARTES, cuenta: "Cuenta Ajena!" };
    const { dependencias, traerLogo } = armar(vidrieraConLogo(mala));
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBeNull();
    expect(traerLogo).not.toHaveBeenCalled();
  });
});

describe("logoPublicoDeLaCarta: cuando el tercero falla", () => {
  it("un fallo se recuerda: la visita siguiente no vuelve a salir (corte de 5 minutos)", async () => {
    const { dependencias, traerLogo } = armar(vidrieraConLogo(PARTES), () =>
      Promise.resolve(err("TIEMPO_AGOTADO")),
    );
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBeNull();
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBeNull();
    expect(traerLogo).toHaveBeenCalledTimes(1);
  });

  it("«ocupado» no se recuerda: es del momento, no del logo", async () => {
    let llamadas = 0;
    const { dependencias, traerLogo } = armar(vidrieraConLogo(PARTES), () =>
      Promise.resolve(++llamadas === 1 ? err("OCUPADO" as const) : ok(BYTES)),
    );
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBeNull();
    expect(await logoPublicoDeLaCarta(dependencias, HOST, "cafe-1", "1700000000.webp")).toBe(BYTES);
    expect(traerLogo).toHaveBeenCalledTimes(2);
  });

  it("un logo cambiado no hereda el fallo ni los bytes del anterior", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    const traerLogo = vi.fn<ImagenesExternas["traerLogo"]>((d) =>
      Promise.resolve(
        d.url.includes("/v1700000000/") ? err("NO_ES_UNA_IMAGEN" as const) : ok(BYTES),
      ),
    );
    const con = (logo: PartesDeDireccion): DependenciasDelLogoPublico => ({
      vidriera: { porCodigo: () => Promise.resolve(vidrieraConLogo(logo)) },
      traedor: { traerLogo },
      memoria,
    });
    expect(await logoPublicoDeLaCarta(con(PARTES), HOST, "cafe-1", "1700000000.webp")).toBeNull();
    const nueva = { ...PARTES, version: "1800000000" };
    expect(await logoPublicoDeLaCarta(con(nueva), HOST, "cafe-1", "1800000000.webp")).toBe(BYTES);
  });

  it("la misma imagen en otra carta se trae aparte (la clave lleva el código)", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    const traerLogo = vi.fn(() => Promise.resolve(ok(BYTES)));
    const de = (codigo: string): DependenciasDelLogoPublico => ({
      vidriera: { porCodigo: () => Promise.resolve(vidrieraConLogo(PARTES, codigo)) },
      traedor: { traerLogo },
      memoria,
    });
    await logoPublicoDeLaCarta(de("cafe-1"), HOST, "cafe-1", "1700000000.webp");
    await logoPublicoDeLaCarta(de("cafe-2"), HOST, "cafe-2", "1700000000.webp");
    expect(traerLogo).toHaveBeenCalledTimes(2);
  });
});
