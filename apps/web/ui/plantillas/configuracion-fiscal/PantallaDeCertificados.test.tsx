import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { armarLaListaDeAmbientes, type CertificadoParaMostrar } from "./modelo-de-certificado";
import { PantallaDeCertificados } from "./PantallaDeCertificados";

/**
 * La lista del certificado de ARCA en Chromium, en el celular (390 px) y en escritorio (1280 px): axe como página sin violaciones
 * (contraste incluido), letra de 16 px o más, controles de 48 px o más, sin desborde, filas que son enlaces reales con el foco visible y
 * los estados dichos con texto (Pendiente, Falta cargar, Vencido; el vigente, solo con su fecha).
 */
afterEach(async () => {
  await page.viewport(390, 844);
});

const CUIT = "20123456786";
const VIGENTE: CertificadoParaMostrar = {
  ambiente: "HOMOLOGACION",
  situacion: "VIGENTE",
  alias: "pedernalprueba",
  cuitTitular: CUIT,
  vence: "2028-10-12",
  vencido: false,
};
const filas = (certificados: readonly CertificadoParaMostrar[]) =>
  armarLaListaDeAmbientes(certificados);

describe.each([390, 1280])("a %i px", (ancho) => {
  it("accesible, legible y tocable, sin desborde; cada estado se dice con texto", async () => {
    await ventana(ancho);
    await render(
      enArmazon(
        "Certificado de ARCA",
        <PantallaDeCertificados
          filas={filas([
            { ...VIGENTE, vencido: true },
            {
              ambiente: "PRODUCCION",
              situacion: "PEDIDO_GENERADO",
              certificadoId: "x",
              alias: "a",
              cuitTitular: CUIT,
            },
          ])}
        />,
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    for (const t of ["Vencido", "Pendiente", "Vence 12/10/2028"]) {
      await expect.element(page.getByText(t, { exact: true })).toBeVisible();
    }
  });
});

describe("las filas y el teclado", () => {
  it("dos enlaces, Pruebas y Producción, en ese orden, y el foco se ve", async () => {
    await render(<PantallaDeCertificados filas={filas([VIGENTE])} />);
    const enlaces = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    expect(enlaces).toEqual([
      "/configuracion-fiscal/certificado-de-arca/pruebas",
      "/configuracion-fiscal/certificado-de-arca/produccion",
    ]);
    await verificarFoco(document.querySelector<HTMLElement>("a[href]") as HTMLElement);
  });

  it("el vigente al día no lleva cartel; sin nada, «Falta cargar» en los dos", async () => {
    await render(<PantallaDeCertificados filas={filas([VIGENTE])} />);
    expect(document.body.textContent).not.toMatch(/Vencido|Pendiente/);
    expect(page.getByText("Falta cargar").elements()).toHaveLength(1);
  });
});
