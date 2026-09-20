package com.jobtracker.util;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;

/** Helpers for reading/writing Postgres JSONB columns through plain JDBC. */
public final class JsonColumns {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonColumns() {}

    public static Object readJson(ResultSet rs, String column) throws SQLException {
        String raw = rs.getString(column);
        if (raw == null) return null;
        try {
            return MAPPER.readValue(raw, Object.class);
        } catch (Exception e) {
            return null;
        }
    }

    public static String toJson(Object value) {
        if (value == null) return null;
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }
}
