"""
Punto de entrada para ejecutar el Servicio Satélite de IA de Ganadito en el puerto 8001.
"""

import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("AI_SATELLITE_PORT", "8001"))
    host = os.environ.get("AI_SATELLITE_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=False)
