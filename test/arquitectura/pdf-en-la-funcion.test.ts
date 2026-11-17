import { describe, expect, it } from "vitest";
import configuracion from "../../apps/web/next.config";

/**
 * El PDF corre en la función de Vercel con `pdfkit` cargado desde node_modules (no empaquetado): es el camino que prueban las pruebas del
 * PDF, y Next copia el paquete y sus tipografías a la función por el rastreo de archivos. Previene: un PDF que funciona en las pruebas y falla
 * en el despliegue por una tipografía que el empaquetador no incluyó (se descubriría con un cliente real).
 */
describe("el PDF en la función de Vercel", () => {
  it("pdfkit se carga desde node_modules y no se empaqueta", () => {
    expect(configuracion.serverExternalPackages).toContain("pdfkit");
  });
});
