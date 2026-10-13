import { describe, expect, it } from "vitest";
import { PROVEEDORES_DE_IMAGEN, VARIANTES_DE_FOTO } from "./proveedores-de-imagen";

/** El catálogo es una lista CERRADA y literal (§5.7.1): cualquier cambio tiene que pasar por esta prueba. */

describe("PROVEEDORES_DE_IMAGEN", () => {
  it("hoy tiene solo Cloudinary", () => {
    expect(Object.keys(PROVEEDORES_DE_IMAGEN)).toEqual(["CLOUDINARY"]);
  });

  it("Cloudinary: host, tipos, límites y extensiones del spec", () => {
    const c = PROVEEDORES_DE_IMAGEN.CLOUDINARY;
    expect(c.host).toBe("res.cloudinary.com");
    expect(c.recurso).toBe("image");
    expect(c.entrega).toBe("upload");
    expect(c.largoMaximoDeCuenta).toBe(64);
    expect(c.largoMaximoDelId).toBe(200);
    expect(c.extensiones).toEqual(["jpg", "jpeg", "png", "webp"]);
  });

  it("el host de cada proveedor es un nombre en minúsculas, sin puerto, barra, arroba ni punto final", () => {
    for (const p of Object.values(PROVEEDORES_DE_IMAGEN)) {
      expect(p.host).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/);
    }
  });

  it("las variantes son 480 y 1200 y la transformación pide recorte 4:3, WebP y calidad fija", () => {
    expect(VARIANTES_DE_FOTO).toEqual([480, 1200]);
    expect(PROVEEDORES_DE_IMAGEN.CLOUDINARY.transformacion(480)).toBe(
      "c_fill,ar_4:3,w_480,f_webp,q_80",
    );
    expect(PROVEEDORES_DE_IMAGEN.CLOUDINARY.transformacion(1200)).toBe(
      "c_fill,ar_4:3,w_1200,f_webp,q_80",
    );
  });
});
