// dsh-browser · 客户端 — 录制管理 Hook
import { useEffect, useState } from "react";
import { deleteRecordingApi, fetchRecordingDetail, fetchRecordings } from "../api.js";
export function useRecordings(base) {
    const [list, setList] = useState(null);
    const [error, setError] = useState("");
    const [expanded, setExpanded] = useState({});
    useEffect(() => {
        let alive = true;
        setList(null);
        setError("");
        fetchRecordings(base)
            .then((rows) => {
            if (alive)
                setList(rows);
        })
            .catch((e) => {
            if (alive)
                setError(e instanceof Error ? e.message : String(e));
        });
        return () => {
            alive = false;
        };
    }, [base]);
    const toggleDetail = (name) => {
        setExpanded((prev) => {
            const current = prev[name];
            if (current !== undefined && current !== "loading") {
                const next = { ...prev };
                delete next[name];
                return next;
            }
            fetchRecordingDetail(base, name)
                .then((d) => {
                setExpanded((pr) => ({ ...pr, [name]: d ?? "failed" }));
            })
                .catch(() => setExpanded((pr) => ({ ...pr, [name]: "failed" })));
            return { ...prev, [name]: "loading" };
        });
    };
    const remove = async (name) => {
        const ok = await deleteRecordingApi(base, name);
        if (ok) {
            setList((prev) => (prev === null ? prev : prev.filter((row) => row.name !== name)));
            setExpanded((prev) => {
                const next = { ...prev };
                delete next[name];
                return next;
            });
        }
    };
    return { list, error, expanded, toggleDetail, remove };
}
//# sourceMappingURL=useRecordings.js.map