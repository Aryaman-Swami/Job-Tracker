package com.jobtracker.util;

import org.springframework.jdbc.core.RowMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;

/** Maps a `jobs` row to the same snake_case JSON shape the old Express API returned. */
public class JobRowMapper implements RowMapper<Map<String, Object>> {

    @Override
    public Map<String, Object> mapRow(ResultSet rs, int rowNum) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getInt("id"));
        row.put("job_ref_id", rs.getString("job_ref_id"));
        row.put("company", rs.getString("company"));
        row.put("role", rs.getString("role"));
        row.put("contact_name", rs.getString("contact_name"));
        row.put("contact_email", rs.getString("contact_email"));
        row.put("job_url", rs.getString("job_url"));
        row.put("status", rs.getString("status"));
        row.put("source", rs.getString("source"));
        row.put("notes", rs.getString("notes"));
        row.put("description", rs.getString("description"));
        row.put("needs_referral", rs.getBoolean("needs_referral"));
        row.put("linkedin_profile_url", rs.getString("linkedin_profile_url"));
        row.put("tailored_resume_latex", rs.getString("tailored_resume_latex"));
        row.put("tailored_skills_match", JsonColumns.readJson(rs, "tailored_skills_match"));
        row.put("date_posted", toIso(rs.getTimestamp("date_posted")));
        row.put("created_at", toIso(rs.getTimestamp("created_at")));
        row.put("updated_at", toIso(rs.getTimestamp("updated_at")));
        row.put("ats_score", rs.getObject("ats_score") == null ? null : rs.getInt("ats_score"));
        row.put("ats_breakdown", JsonColumns.readJson(rs, "ats_breakdown"));
        row.put("ats_matched_keywords", JsonColumns.readJson(rs, "ats_matched_keywords"));
        row.put("ats_missing_keywords", JsonColumns.readJson(rs, "ats_missing_keywords"));
        row.put("ats_suggestions", JsonColumns.readJson(rs, "ats_suggestions"));
        row.put("ats_scored_at", toIso(rs.getTimestamp("ats_scored_at")));
        return row;
    }

    private static String toIso(Timestamp ts) {
        return ts == null ? null : ts.toInstant().toString();
    }
}
