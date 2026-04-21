import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";

// 🔥 auto zoom component
function AutoZoom({ points }) {
    const map = useMap();

    useEffect(() => {
    if (!points || points.length === 0) return;
    map.fitBounds(points, { padding: [50, 50] });
    }, [points, map]);

    return null;
}

export default function MapView({
    workerLat,
    workerLng,
    customerLat,
    customerLng,
}) {
    const [workerPos, setWorkerPos] = useState([workerLat, workerLng]);

  // 🔥 smooth movement animation
    useEffect(() => {
    const interval = setInterval(() => {
        setWorkerPos((prev) => {
        const newLat = prev[0] + (customerLat - prev[0]) * 0.05;
        const newLng = prev[1] + (customerLng - prev[1]) * 0.05;
        return [newLat, newLng];
        });
    }, 1000);

    return () => clearInterval(interval);
    }, [customerLat, customerLng]);

    const customerPos = [customerLat, customerLng];
    const points = [workerPos, customerPos];

    return (
    <MapContainer
        center={workerPos}
        zoom={13}
        style={{ height: "320px", borderRadius: "12px" }}
    >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {/* 🔥 Worker marker */}
        <Marker position={workerPos} />

      {/* 🔥 Customer marker */}
        <Marker position={customerPos} />

      {/* 🔥 Route line */}
        <Polyline positions={points} />

      {/* 🔥 Auto zoom */}
        <AutoZoom points={points} />
    </MapContainer>
    );
}