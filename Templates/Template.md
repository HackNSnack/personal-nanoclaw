---
created: <% tp.file.creation_date() %>
---
# <% moment(tp.file.title,'YYYY-MM-DD').format("dddd, MMMM DD, YYYY") %>

<< [[Daily Tracker/<% tp.date.now("YYYY", -1) %>/<% tp.date.now("MM-MMMM", -1) %>/<% tp.date.now("YYYY-MM-DD-dddd", -1) %>| |Yesterday]] | [[Daily Tracker/<% tp.date.now("YYYY", 0) %>/<% tp.date.now("MM-MMMM", 0) %>/<% tp.date.now("YYYY-MM-DD-dddd", 0) %>||Today]] | [[Daily Tracker/<% tp.date.now("YYYY", 1) %>/<% tp.date.now("MM-MMMM", 1) %>/<% tp.date.now("YYYY-MM-DD-dddd", 1) %>|Tomorrow]] >>


---
### ❇️ Daily Tasks

##### 🚀 Things I plan to accomplish today is...
- [ ] 


---
# 📝 Notes


---
### Notes created today
```dataview
List FROM "" WHERE file.cday = date("<%tp.date.now("YYYY-MM-DD")%>") SORT file.ctime asc
```

### Notes last touched today
```dataview
List FROM "" WHERE file.mday = date("<%tp.date.now("YYYY-MM-DD")%>") SORT file.mtime asc
```